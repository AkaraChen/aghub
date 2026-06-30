use log::{debug, info, warn};
use posthog_rs::{client, Client, ClientOptionsBuilder, Event};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tokio::sync::OnceCell;
use uuid::Uuid;

/// Reads `POSTHOG_KEY` and `POSTHOG_HOST` at compile time so
/// the desktop binary embeds the project key. The webview reads the
/// same values through `posthog_get_config` instead of Vite env. When the env
/// vars are unset (e.g. local dev without a `.env`) every command
/// becomes a silent no-op so analytics never blocks the user flow.
///
/// We route event capture through Rust because posthog-js fetch calls
/// silently fail in some Tauri v2 webviews (PostHog/posthog-js#1760).
const POSTHOG_KEY: Option<&str> = option_env!("POSTHOG_KEY");
const POSTHOG_HOST: Option<&str> = option_env!("POSTHOG_HOST");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosthogConfig {
	key: Option<&'static str>,
	host: Option<&'static str>,
}

/// Filename for the persistent per-install distinct_id. Lives in the
/// Tauri app data dir so a reinstall keeps the same identity but
/// uninstalling clears it. Matches the convention posthog-js uses
/// (localStorage in the webview).
const DISTINCT_ID_FILE: &str = "posthog-distinct-id";

static CLIENT: OnceCell<Option<Client>> = OnceCell::const_new();

/// Mirrors the user's analytics consent in the desktop store. Starts
/// fail-closed so analytics remains disabled until the webview
/// successfully syncs a granted consent state. When `false`,
/// `posthog_capture` and `posthog_identify` short-circuit before
/// constructing or touching the client.
static ENABLED: AtomicBool = AtomicBool::new(false);

/// Generated once per process start. PostHog uses this to group events
/// into a session for live events / session replay / funnels. posthog-js
/// generates one automatically; the Rust SDK does not, so we own it.
static SESSION_ID: OnceLock<String> = OnceLock::new();

async fn build_client() -> Option<Client> {
	let Some(key) = POSTHOG_KEY else {
		warn!(
			"posthog: POSTHOG_KEY was not embedded at compile time; \
			analytics disabled. Make sure crates/desktop/.env exists \
			before running cargo build."
		);
		return None;
	};
	if key.is_empty() {
		warn!("posthog: POSTHOG_KEY is empty; analytics disabled");
		return None;
	}
	let host_log = POSTHOG_HOST.unwrap_or("https://us.i.posthog.com (default)");
	let mut builder = ClientOptionsBuilder::default();
	builder.api_key(key.to_string());
	if let Some(host) = POSTHOG_HOST.filter(|h| !h.is_empty()) {
		builder.host(host.to_string());
	}
	let options = match builder.build() {
		Ok(options) => options,
		Err(error) => {
			warn!("posthog: invalid client options: {error}");
			return None;
		}
	};
	info!("posthog: client initialized for host {host_log}");
	Some(client(options).await)
}

async fn get_client() -> Option<&'static Client> {
	CLIENT.get_or_init(build_client).await.as_ref()
}

#[tauri::command]
pub fn posthog_get_config() -> PosthogConfig {
	PosthogConfig {
		key: POSTHOG_KEY.filter(|value| !value.is_empty()),
		host: POSTHOG_HOST.filter(|value| !value.is_empty()),
	}
}

fn session_id() -> &'static str {
	SESSION_ID.get_or_init(|| Uuid::new_v4().to_string())
}

fn distinct_id_file_path(app: &AppHandle) -> Option<PathBuf> {
	let dir = app
		.path()
		.app_data_dir()
		.map_err(|error| {
			warn!("posthog: failed to resolve app data dir: {error}");
		})
		.ok()?;
	if let Err(error) = fs::create_dir_all(&dir) {
		warn!("posthog: failed to create app data dir: {error}");
		return None;
	}
	Some(dir.join(DISTINCT_ID_FILE))
}

fn persist_distinct_id(app: &AppHandle, distinct_id: &str) {
	if let Some(path) = distinct_id_file_path(app) {
		if let Err(error) = fs::write(&path, distinct_id) {
			warn!(
				"posthog: failed to persist distinct_id at {}: {error}",
				path.display()
			);
		}
	}
}

fn read_or_create_distinct_id(app: &AppHandle) -> String {
	match distinct_id_file_path(app) {
		Some(path) => match fs::read_to_string(&path) {
			Ok(content) => {
				let trimmed = content.trim().to_string();
				if trimmed.is_empty() {
					let id = Uuid::new_v4().to_string();
					persist_distinct_id(app, &id);
					id
				} else {
					trimmed
				}
			}
			Err(_) => {
				let id = Uuid::new_v4().to_string();
				persist_distinct_id(app, &id);
				id
			}
		},
		None => Uuid::new_v4().to_string(),
	}
}

fn replace_distinct_id(app: &AppHandle, distinct_id: &str) -> String {
	let previous = read_or_create_distinct_id(app);
	persist_distinct_id(app, distinct_id);
	previous
}

fn apply_properties(event: &mut Event, properties: HashMap<String, Value>) {
	for (key, value) in properties {
		if let Err(error) = event.insert_prop(key.as_str(), value) {
			warn!("posthog: failed to set prop {key}: {error}");
		}
	}
}

/// Adds the session/platform context PostHog needs to group events
/// into a usable session for live events, persons, and replay.
fn apply_default_properties(event: &mut Event) {
	let _ = event.insert_prop("$session_id", session_id());
	let _ = event.insert_prop(
		"$os",
		if cfg!(target_os = "macos") {
			"Mac OS X"
		} else if cfg!(target_os = "windows") {
			"Windows"
		} else if cfg!(target_os = "linux") {
			"Linux"
		} else {
			"Unknown"
		},
	);
	let _ = event.insert_prop("$app_name", env!("CARGO_PKG_NAME"));
	let _ = event.insert_prop("$app_version", env!("CARGO_PKG_VERSION"));
}

/// Capture a regular event (`capture` in posthog-js terms).
///
/// Detaches the actual HTTP send via `tokio::spawn` so the IPC reply
/// isn't blocked on the network round-trip. Without this, the command
/// future runs as part of Tauri's invoke-handler task and is at risk
/// of being dropped if the webview context tears down or another
/// command races ahead — explaining why early-bootstrap events
/// (`app started`) never reach PostHog while idle-time events
/// (`onboarding completed`) do.
#[tauri::command]
pub async fn posthog_capture(
	app: AppHandle,
	event: String,
	properties: HashMap<String, Value>,
	distinct_id: Option<String>,
) -> Result<(), String> {
	if !ENABLED.load(Ordering::Relaxed) {
		return Ok(());
	}
	let Some(client) = get_client().await else {
		return Ok(());
	};
	let did = distinct_id
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| read_or_create_distinct_id(&app));
	let mut ev = Event::new(event.as_str(), did.as_str());
	apply_default_properties(&mut ev);
	apply_properties(&mut ev, properties);

	// posthog-rs 0.15 `capture` enqueues into the client's background sender and
	// returns immediately — there is no per-event send result to await or log.
	client.capture(ev);
	debug!("posthog: capture {event} dispatched");
	Ok(())
}

/// Identify a user. The Rust SDK has no separate `identify()` API;
/// identification is just a `$identify` event whose properties become
/// the user's `$set`. We mirror posthog-js's behavior: any properties
/// passed in are merged onto the user via `$set`. Also persists the
/// new distinct_id so subsequent anonymous captures get attributed
/// to the same person.
#[tauri::command]
pub async fn posthog_identify(
	app: AppHandle,
	distinct_id: String,
	properties: HashMap<String, Value>,
) -> Result<(), String> {
	if !ENABLED.load(Ordering::Relaxed) {
		return Ok(());
	}
	let Some(client) = get_client().await else {
		return Ok(());
	};

	let anon_distinct_id = replace_distinct_id(&app, &distinct_id);

	let mut ev = Event::new("$identify", distinct_id.as_str());
	apply_default_properties(&mut ev);
	if anon_distinct_id != distinct_id {
		if let Err(error) =
			ev.insert_prop("$anon_distinct_id", anon_distinct_id)
		{
			warn!(
				"posthog: failed to set $anon_distinct_id on identify: {error}"
			);
		}
	}
	if !properties.is_empty() {
		let set_value = Value::Object(
			properties.into_iter().collect::<serde_json::Map<_, _>>(),
		);
		if let Err(error) = ev.insert_prop("$set", set_value) {
			warn!("posthog: failed to set $set on identify: {error}");
		}
	}

	client.capture(ev);
	debug!("posthog: identify {distinct_id} dispatched");
	Ok(())
}

/// Hand the persistent distinct_id to the webview so posthog-js can be
/// bootstrapped with the same identity. This is the linchpin of the
/// Rust-events + JS-replay split: when posthog-js calls
/// `posthog.init(..., { bootstrap: { distinctID } })` with this value,
/// session replay segments and Rust-originated events both attach to
/// the same person in PostHog.
#[tauri::command]
pub async fn posthog_get_distinct_id(app: AppHandle) -> String {
	read_or_create_distinct_id(&app)
}

/// Hand the per-process session id to the webview so posthog-js can
/// share it via `register_session({ session_id })` if desired. Letting
/// both sides agree on $session_id is what stitches Rust events and
/// JS replays into the same PostHog session.
#[tauri::command]
pub async fn posthog_get_session_id() -> String {
	session_id().to_string()
}

/// Toggle Rust-side capture/identify based on the user's analytics
/// consent. The webview owns the consent UI and persistence (in the
/// Tauri store), so it's responsible for syncing the flag here on
/// boot and whenever the user toggles it in Settings.
#[tauri::command]
pub fn posthog_set_enabled(enabled: bool) {
	let previous = ENABLED.swap(enabled, Ordering::Relaxed);
	if previous != enabled {
		info!(
			"posthog: capture {}",
			if enabled { "enabled" } else { "disabled" }
		);
	}
}

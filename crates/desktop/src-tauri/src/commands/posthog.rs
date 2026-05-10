use log::warn;
use posthog_rs::{client, Client, ClientOptionsBuilder, Event};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tokio::sync::OnceCell;
use uuid::Uuid;

/// Reads `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` at compile time so
/// the desktop binary embeds the project key, matching the way the
/// webview reads them through Vite's `import.meta.env`. When the env
/// vars are unset (e.g. local dev without a `.env`) every command
/// becomes a silent no-op so analytics never blocks the user flow.
///
/// We route event capture through Rust because posthog-js fetch calls
/// silently fail in some Tauri v2 webviews (PostHog/posthog-js#1760).
const POSTHOG_KEY: Option<&str> = option_env!("VITE_POSTHOG_KEY");
const POSTHOG_HOST: Option<&str> = option_env!("VITE_POSTHOG_HOST");

/// Filename for the persistent per-install distinct_id. Lives in the
/// Tauri app data dir so a reinstall keeps the same identity but
/// uninstalling clears it. Matches the convention posthog-js uses
/// (localStorage in the webview).
const DISTINCT_ID_FILE: &str = "posthog-distinct-id";

static CLIENT: OnceCell<Option<Client>> = OnceCell::const_new();

/// Generated once per process start. PostHog uses this to group events
/// into a session for live events / session replay / funnels. posthog-js
/// generates one automatically; the Rust SDK does not, so we own it.
static SESSION_ID: OnceLock<String> = OnceLock::new();

/// Resolved on first capture call and cached. Persisted across restarts.
static DISTINCT_ID: OnceLock<String> = OnceLock::new();

async fn build_client() -> Option<Client> {
	let key = POSTHOG_KEY?;
	if key.is_empty() {
		return None;
	}
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
	Some(client(options).await)
}

async fn get_client() -> Option<&'static Client> {
	CLIENT.get_or_init(build_client).await.as_ref()
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

/// Read the persisted distinct_id, generating + writing one if missing
/// or unreadable. Falls back to an in-memory UUID if the disk path is
/// unavailable for any reason — better than reusing "anonymous".
fn resolve_distinct_id(app: &AppHandle) -> String {
	if let Some(cached) = DISTINCT_ID.get() {
		return cached.clone();
	}
	let resolved = match distinct_id_file_path(app) {
		Some(path) => match fs::read_to_string(&path) {
			Ok(content) => {
				let trimmed = content.trim().to_string();
				if !trimmed.is_empty() {
					trimmed
				} else {
					let id = Uuid::new_v4().to_string();
					let _ = fs::write(&path, &id);
					id
				}
			}
			Err(_) => {
				let id = Uuid::new_v4().to_string();
				if let Err(error) = fs::write(&path, &id) {
					warn!(
						"posthog: failed to persist distinct_id at {}: {error}",
						path.display()
					);
				}
				id
			}
		},
		None => Uuid::new_v4().to_string(),
	};
	let _ = DISTINCT_ID.set(resolved.clone());
	resolved
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
#[tauri::command]
pub async fn posthog_capture(
	app: AppHandle,
	event: String,
	properties: HashMap<String, Value>,
	distinct_id: Option<String>,
) -> Result<(), String> {
	let Some(client) = get_client().await else {
		return Ok(());
	};
	let did = distinct_id
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| resolve_distinct_id(&app));
	let mut ev = Event::new(event.as_str(), did.as_str());
	apply_default_properties(&mut ev);
	apply_properties(&mut ev, properties);
	if let Err(error) = client.capture(ev).await {
		warn!("posthog: capture failed for {event}: {error}");
	}
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
	let Some(client) = get_client().await else {
		return Ok(());
	};

	// Persist the identified id so future anonymous captures use it.
	if let Some(path) = distinct_id_file_path(&app) {
		if let Err(error) = fs::write(&path, &distinct_id) {
			warn!(
				"posthog: failed to persist distinct_id at {}: {error}",
				path.display()
			);
		}
	}
	// Replace the cached value (OnceLock can't mutate, but the next
	// process start will read the file we just wrote).

	let mut ev = Event::new("$identify", distinct_id.as_str());
	apply_default_properties(&mut ev);
	if !properties.is_empty() {
		let set_value = Value::Object(
			properties.into_iter().collect::<serde_json::Map<_, _>>(),
		);
		if let Err(error) = ev.insert_prop("$set", set_value) {
			warn!("posthog: failed to set $set on identify: {error}");
		}
	}
	if let Err(error) = client.capture(ev).await {
		warn!("posthog: identify failed for {distinct_id}: {error}");
	}
	Ok(())
}

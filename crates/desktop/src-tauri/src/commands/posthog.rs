use log::warn;
use posthog_rs::{client, Client, ClientOptionsBuilder, Event};
use serde_json::Value;
use std::collections::HashMap;
use tokio::sync::OnceCell;

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

static CLIENT: OnceCell<Option<Client>> = OnceCell::const_new();

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

fn distinct_id_or_anon(value: Option<String>) -> String {
	value
		.filter(|s| !s.is_empty())
		.unwrap_or_else(|| "anonymous".to_string())
}

fn apply_properties(event: &mut Event, properties: HashMap<String, Value>) {
	for (key, value) in properties {
		if let Err(error) = event.insert_prop(key.as_str(), value) {
			warn!("posthog: failed to set prop {key}: {error}");
		}
	}
}

/// Capture a regular event (`capture` in posthog-js terms).
#[tauri::command]
pub async fn posthog_capture(
	event: String,
	properties: HashMap<String, Value>,
	distinct_id: Option<String>,
) -> Result<(), String> {
	let Some(client) = get_client().await else {
		return Ok(());
	};
	let did = distinct_id_or_anon(distinct_id);
	let mut ev = Event::new(event.as_str(), did.as_str());
	apply_properties(&mut ev, properties);
	if let Err(error) = client.capture(ev).await {
		warn!("posthog: capture failed for {event}: {error}");
	}
	Ok(())
}

/// Identify a user. The Rust SDK has no separate `identify()` API;
/// identification is just a `$identify` event whose properties become
/// the user's `$set`. We mirror posthog-js's behavior: any properties
/// passed in are merged onto the user via `$set`.
#[tauri::command]
pub async fn posthog_identify(
	distinct_id: String,
	properties: HashMap<String, Value>,
) -> Result<(), String> {
	let Some(client) = get_client().await else {
		return Ok(());
	};
	let mut ev = Event::new("$identify", distinct_id.as_str());
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

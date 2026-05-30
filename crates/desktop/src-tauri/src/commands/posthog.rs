use crate::commands::app_config::{current_app_config, set_distinct_id};
use log::{debug, info, warn};
use posthog_rs::{client, Client, ClientOptionsBuilder, Event};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;
use tauri::AppHandle;
use tokio::sync::OnceCell;

static CLIENT: OnceCell<Option<Client>> = OnceCell::const_new();

async fn build_client() -> Option<Client> {
	let Some(config) = current_app_config() else {
		warn!("posthog: app config was not initialized; analytics disabled");
		return None;
	};
	let Some(key) = config.posthog.key.filter(|key| !key.is_empty()) else {
		info!("posthog: no project key configured; analytics disabled");
		return None;
	};

	let mut builder = ClientOptionsBuilder::default();
	builder.api_key(key);
	builder.host(config.posthog.host.clone());

	let options = match builder.build() {
		Ok(options) => options,
		Err(error) => {
			warn!("posthog: invalid client options: {error}");
			return None;
		}
	};
	info!(
		"posthog: client initialized for host {}",
		config.posthog.host
	);
	Some(client(options).await)
}

async fn get_client() -> Option<&'static Client> {
	CLIENT.get_or_init(build_client).await.as_ref()
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
fn apply_default_properties(event: &mut Event, session_id: &str) {
	let _ = event.insert_prop("$session_id", session_id);
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
/// isn't blocked on the network round-trip.
#[tauri::command]
pub async fn posthog_capture(
	event: String,
	properties: HashMap<String, Value>,
	distinct_id: Option<String>,
) -> Result<(), String> {
	let Some(config) = current_app_config() else {
		return Ok(());
	};
	let Some(client) = get_client().await else {
		return Ok(());
	};
	if !config.analytics_enabled {
		return Ok(());
	}

	let did = distinct_id
		.filter(|value| !value.is_empty())
		.unwrap_or_else(|| config.posthog.distinct_id.clone());
	let mut ev = Event::new(event.as_str(), did.as_str());
	apply_default_properties(&mut ev, config.posthog.session_id.as_str());
	apply_properties(&mut ev, properties);

	let event_label = event.clone();
	tokio::spawn(async move {
		let started = Instant::now();
		match client.capture(ev).await {
			Ok(()) => debug!(
				"posthog: capture {event_label} sent in {:?}",
				started.elapsed()
			),
			Err(error) => warn!(
				"posthog: capture {event_label} failed after {:?}: {error}",
				started.elapsed()
			),
		}
	});
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
	let Some(config) = current_app_config() else {
		return Ok(());
	};
	let Some(client) = get_client().await else {
		return Ok(());
	};
	if !config.analytics_enabled {
		return Ok(());
	}

	set_distinct_id(&app, &distinct_id);

	let mut ev = Event::new("$identify", distinct_id.as_str());
	apply_default_properties(&mut ev, config.posthog.session_id.as_str());
	if !properties.is_empty() {
		let set_value = Value::Object(
			properties.into_iter().collect::<serde_json::Map<_, _>>(),
		);
		if let Err(error) = ev.insert_prop("$set", set_value) {
			warn!("posthog: failed to set $set on identify: {error}");
		}
	}

	let id_label = distinct_id.clone();
	tokio::spawn(async move {
		let started = Instant::now();
		match client.capture(ev).await {
			Ok(()) => debug!(
				"posthog: identify {id_label} sent in {:?}",
				started.elapsed()
			),
			Err(error) => warn!(
				"posthog: identify {id_label} failed after {:?}: {error}",
				started.elapsed()
			),
		}
	});
	Ok(())
}

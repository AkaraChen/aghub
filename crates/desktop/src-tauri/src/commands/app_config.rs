use log::warn;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const POSTHOG_KEY: Option<&str> = option_env!("POSTHOG_KEY");
const POSTHOG_HOST: Option<&str> = option_env!("POSTHOG_HOST");
const DEFAULT_POSTHOG_HOST: &str = "https://us.i.posthog.com";
const DISTINCT_ID_FILE: &str = "posthog-distinct-id";

static APP_CONFIG: OnceLock<RwLock<AppConfig>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
	/// Whether analytics capture is allowed. Defaults to false until the
	/// user explicitly opts in from onboarding/settings.
	pub analytics_enabled: bool,
	pub app_version: String,
	pub posthog: PostHogConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostHogConfig {
	pub key: Option<String>,
	pub host: String,
	pub distinct_id: String,
	pub session_id: String,
}

fn env_posthog_key() -> Option<String> {
	POSTHOG_KEY
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.map(ToOwned::to_owned)
}

fn env_posthog_host() -> String {
	POSTHOG_HOST
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.unwrap_or(DEFAULT_POSTHOG_HOST)
		.to_owned()
}

fn app_data_dir(app: &AppHandle) -> Option<PathBuf> {
	let dir = app
		.path()
		.app_data_dir()
		.map_err(|error| {
			warn!("app_config: failed to resolve app data dir: {error}");
		})
		.ok()?;
	if let Err(error) = fs::create_dir_all(&dir) {
		warn!("app_config: failed to create app data dir: {error}");
		return None;
	}
	Some(dir)
}

fn distinct_id_file_path(app: &AppHandle) -> Option<PathBuf> {
	Some(app_data_dir(app)?.join(DISTINCT_ID_FILE))
}

fn resolve_distinct_id(app: &AppHandle) -> String {
	let Some(path) = distinct_id_file_path(app) else {
		return Uuid::new_v4().to_string();
	};

	if let Ok(content) = fs::read_to_string(&path) {
		let trimmed = content.trim();
		if !trimmed.is_empty() {
			return trimmed.to_owned();
		}
	}

	let id = Uuid::new_v4().to_string();
	if let Err(error) = fs::write(&path, &id) {
		warn!(
			"app_config: failed to persist distinct_id at {}: {error}",
			path.display()
		);
	}
	id
}

fn read_persisted_analytics_enabled(app: &AppHandle) -> bool {
	let Some(path) = app_data_dir(app).map(|dir| dir.join("store.json")) else {
		return false;
	};
	let Ok(content) = fs::read_to_string(&path) else {
		return false;
	};
	let Ok(store) = serde_json::from_str::<serde_json::Value>(&content) else {
		return false;
	};
	store
		.get("analyticsConsent")
		.and_then(serde_json::Value::as_str)
		.is_some_and(|value| value == "granted")
}

fn initial_app_config(app: &AppHandle) -> AppConfig {
	AppConfig {
		analytics_enabled: read_persisted_analytics_enabled(app),
		app_version: env!("CARGO_PKG_VERSION").to_owned(),
		posthog: PostHogConfig {
			key: env_posthog_key(),
			host: env_posthog_host(),
			distinct_id: resolve_distinct_id(app),
			session_id: Uuid::new_v4().to_string(),
		},
	}
}

fn config_cell(app: &AppHandle) -> &'static RwLock<AppConfig> {
	APP_CONFIG.get_or_init(|| RwLock::new(initial_app_config(app)))
}

pub fn current_app_config() -> Option<AppConfig> {
	APP_CONFIG
		.get()
		.and_then(|cell| cell.read().ok().map(|config| config.clone()))
}

pub fn set_distinct_id(app: &AppHandle, distinct_id: &str) {
	if let Some(path) = distinct_id_file_path(app) {
		if let Err(error) = fs::write(&path, distinct_id) {
			warn!(
				"app_config: failed to persist distinct_id at {}: {error}",
				path.display()
			);
		}
	}
	if let Some(cell) = APP_CONFIG.get() {
		if let Ok(mut config) = cell.write() {
			config.posthog.distinct_id = distinct_id.to_owned();
		}
	}
}

#[tauri::command]
pub fn get_app_config(app: AppHandle) -> AppConfig {
	config_cell(&app)
		.read()
		.map(|config| config.clone())
		.unwrap_or_else(|_| initial_app_config(&app))
}

#[tauri::command]
pub fn set_app_config(app: AppHandle, config: AppConfig) -> AppConfig {
	let cell = config_cell(&app);
	if let Ok(mut current) = cell.write() {
		*current = config;
		return current.clone();
	}
	initial_app_config(&app)
}

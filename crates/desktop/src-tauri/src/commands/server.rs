use crate::AppState;
use aghub_api::{start, ApiOptions};
use log::{debug, error, info, warn};
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
	pub port: u16,
	pub token: String,
}

fn find_available_port() -> Result<u16, String> {
	let listener = std::net::TcpListener::bind("127.0.0.1:0")
		.map_err(|e| e.to_string())?;
	let port = listener.local_addr().map_err(|e| e.to_string())?.port();
	Ok(port)
}

/// Compute the read-only fallback shipped beside a packaged desktop build.
/// Runtime source selection and validation belong to `aghub-usage`; this only
/// supplies the bundle-specific candidate path that the API cannot derive.
fn bundled_ccusage_bin(app: &tauri::AppHandle) -> Option<PathBuf> {
	if cfg!(debug_assertions) {
		return None;
	}
	tauri::process::current_binary(&app.env())
		.ok()
		.and_then(|exe| {
			exe.parent().map(|dir| {
				dir.join(format!("ccusage{}", std::env::consts::EXE_SUFFIX))
			})
		})
}

/// Read the former frontend-owned sidecar setting once. The runtime persists it
/// into `<app-data>/ccusage/runtime.json`; usage requests never read this store.
fn legacy_ccusage_preference(
	app: &tauri::AppHandle,
) -> Option<aghub_usage::runtime::CcusageRuntimePreference> {
	let store = app.store("store.json").ok()?;
	let settings = store.get("usageSettings")?;
	let sidecar = settings.get("sidecar")?;
	if sidecar.get("autoDiscover").and_then(|v| v.as_bool()) != Some(false) {
		return None;
	}
	let path = sidecar.get("binPath")?.as_str()?.trim();
	if path.is_empty() {
		return None;
	}
	Some(aghub_usage::runtime::CcusageRuntimePreference::Manual(
		PathBuf::from(path),
	))
}

#[tauri::command]
pub async fn start_server(
	state: tauri::State<'_, AppState>,
	app: tauri::AppHandle,
) -> Result<ServerInfo, String> {
	let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
	let bundled_ccusage_bin = bundled_ccusage_bin(&app);
	let legacy_ccusage_preference = legacy_ccusage_preference(&app);
	if bundled_ccusage_bin.is_none() {
		warn!("bundled ccusage fallback is unavailable; runtime discovery will use configured external or app-data sources");
	}
	let server = {
		let mut guard = state.server.lock().unwrap();
		if let Some(server) = guard.as_ref() {
			debug!("reusing embedded API server port {}", server.port);
			return Ok(server.clone());
		}

		let port = find_available_port()?;
		let token = aghub_api::auth::generate_auth_token();
		let server = ServerInfo { port, token };
		*guard = Some(server.clone());
		debug!("stored embedded API server port {port} in application state");
		server
	};

	let port = server.port;
	let token = server.token.clone();
	info!("received request to start embedded API server on port {port}");
	tokio::spawn(async move {
		info!("starting embedded API server on 127.0.0.1:{port}");
		let mut options = ApiOptions::new(port);
		options.app_data_dir = Some(app_data_dir);
		options.auth_token = Some(token);
		options.ccusage_bundled_bin = bundled_ccusage_bin;
		options.ccusage_legacy_preference = legacy_ccusage_preference;
		if let Err(error) = start(options).await {
			error!("embedded API server exited with error: {error}");
		}
	});
	Ok(server)
}

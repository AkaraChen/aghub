use crate::AppState;
use aghub_api::{start, ApiOptions};
use log::{debug, error, info, warn};
use std::path::PathBuf;
use tauri::Manager;

fn find_available_port() -> Result<u16, String> {
	let listener = std::net::TcpListener::bind("127.0.0.1:0")
		.map_err(|e| e.to_string())?;
	let port = listener.local_addr().map_err(|e| e.to_string())?.port();
	Ok(port)
}

/// Resolve the bundled `ccusage` sidecar path to hand to the embedded API.
///
/// Resolution order:
/// 1. `AGHUB_CCUSAGE_BIN` env var — explicit override, always wins (used in dev
///    and as a prod escape hatch).
/// 2. dev build (`tauri dev` / `cargo run`) — no sidecar is staged next to the
///    executable, so return `None` and let the API fall back to `ccusage` on PATH.
/// 3. packaged build — the sidecar ships beside the main executable as `ccusage`
///    (Tauri strips the `-<triple>` suffix at bundle time). We trust the computed
///    path: if the fetch step was skipped the API surfaces a clear spawn error
///    rather than us silently masking it with a PATH fallback.
///
/// `tauri::process::current_binary` is preferred over std's `current_exe`
/// because it returns the real path under AppImage (not the temp mountpoint).
fn resolve_ccusage_bin(app: &tauri::AppHandle) -> Option<PathBuf> {
	if let Some(path) = std::env::var_os("AGHUB_CCUSAGE_BIN") {
		return Some(PathBuf::from(path));
	}
	if cfg!(debug_assertions) {
		return None;
	}
	tauri::process::current_binary(&app.env())
		.ok()
		.and_then(|exe| exe.parent().map(|dir| dir.join("ccusage")))
}

#[tauri::command]
pub async fn start_server(
	state: tauri::State<'_, AppState>,
	app: tauri::AppHandle,
) -> Result<u16, String> {
	let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
	let ccusage_bin = resolve_ccusage_bin(&app);
	if ccusage_bin.is_none() {
		warn!("ccusage sidecar not resolved; usage monitoring will fall back to AGHUB_CCUSAGE_BIN / PATH");
	}
	let port = {
		let mut guard = state.port.lock().unwrap();
		if let Some(port) = *guard {
			debug!("reusing embedded API server port {port}");
			return Ok(port);
		}

		let port = find_available_port()?;
		*guard = Some(port);
		debug!("stored embedded API server port {port} in application state");
		port
	};

	info!("received request to start embedded API server on port {port}");
	tokio::spawn(async move {
		info!("starting embedded API server on 127.0.0.1:{port}");
		if let Err(error) = start(ApiOptions {
			port,
			app_data_dir: Some(app_data_dir),
			ccusage_bin,
		})
		.await
		{
			error!("embedded API server exited with error: {error}");
		}
	});
	Ok(port)
}

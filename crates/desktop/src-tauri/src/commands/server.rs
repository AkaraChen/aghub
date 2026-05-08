use crate::AppState;
use aghub_api::{start, ApiOptions};
use log::{debug, error, info};
use tauri::Manager;

fn find_available_port() -> Result<u16, String> {
	let listener = std::net::TcpListener::bind("127.0.0.1:0")
		.map_err(|e| e.to_string())?;
	let port = listener.local_addr().map_err(|e| e.to_string())?.port();
	Ok(port)
}

#[tauri::command]
pub async fn start_server(
	state: tauri::State<'_, AppState>,
	app: tauri::AppHandle,
) -> Result<u16, String> {
	let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
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
		})
		.await
		{
			error!("embedded API server exited with error: {error}");
		}
	});
	Ok(port)
}

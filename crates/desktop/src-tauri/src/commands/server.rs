use crate::AppState;
use aghub_api::{start, ApiOptions};
use log::{debug, error, info};
use serde::Serialize;
use tauri::Manager;

#[derive(Clone, Serialize)]
pub struct ServerInfo {
	pub port: u16,
	pub auth_token: String,
}

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
) -> Result<ServerInfo, String> {
	let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
	let server = {
		let mut guard = state.server.lock().unwrap();
		if let Some(server) = guard.clone() {
			debug!("reusing embedded API server port {}", server.port);
			return Ok(server);
		}

		let server = ServerInfo {
			port: find_available_port()?,
			auth_token: uuid::Uuid::new_v4().to_string(),
		};
		*guard = Some(server.clone());
		debug!(
			"stored embedded API server port {} in application state",
			server.port
		);
		server
	};

	let port = server.port;
	let auth_token = server.auth_token.clone();
	info!("received request to start embedded API server on port {port}");
	tokio::spawn(async move {
		info!("starting embedded API server on 127.0.0.1:{port}");
		if let Err(error) = start(ApiOptions {
			port,
			app_data_dir: Some(app_data_dir),
			auth_token: Some(auth_token),
		})
		.await
		{
			error!("embedded API server exited with error: {error}");
		}
	});
	Ok(server)
}

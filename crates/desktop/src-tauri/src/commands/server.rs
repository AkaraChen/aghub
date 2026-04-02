use crate::AppState;
use aghub_api::{start, ApiOptions};
use log::{debug, error, info};

fn find_available_port() -> Result<u16, String> {
	let listener = std::net::TcpListener::bind("127.0.0.1:0")
		.map_err(|e| e.to_string())?;
	let port = listener.local_addr().map_err(|e| e.to_string())?.port();
	Ok(port)
}

#[tauri::command]
pub async fn start_server(
	state: tauri::State<'_, AppState>,
) -> Result<u16, String> {
	let port = find_available_port()?;
	info!("received request to start embedded API server on port {port}");
	tokio::spawn(async move {
		info!("starting embedded API server on 127.0.0.1:{port}");
		if let Err(error) = start(ApiOptions { port }).await {
			error!("embedded API server exited with error: {error}");
		}
	});
	*state.port.lock().unwrap() = Some(port);
	debug!("stored embedded API server port {port} in application state");
	Ok(port)
}

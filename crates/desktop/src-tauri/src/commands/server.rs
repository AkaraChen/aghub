use aghub_api::{ApiOptions, start};
use crate::AppState;

fn find_available_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    Ok(port)
}

#[tauri::command]
pub async fn start_server(state: tauri::State<'_, AppState>) -> Result<u16, String> {
    let port = find_available_port()?;
    tokio::spawn(async move {
        let _ = start(ApiOptions { port }).await;
    });
    *state.port.lock().unwrap() = Some(port);
    Ok(port)
}

use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn minimize_to_tray(app: AppHandle) -> Result<(), String> {
	let Some(window) = app.get_webview_window("main") else {
		return Ok(());
	};

	#[cfg(windows)]
	{
		window.hide().map_err(|error| error.to_string())?;
	}

	#[cfg(not(windows))]
	{
		window.minimize().map_err(|error| error.to_string())?;
	}

	Ok(())
}

use crate::commands::start_server;

mod commands;

pub struct AppState {
	pub port: std::sync::Mutex<Option<u16>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.manage(AppState {
			port: std::sync::Mutex::new(None),
		})
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.setup(|app| {
			#[cfg(desktop)]
			app.handle()
				.plugin(tauri_plugin_updater::Builder::new().build());
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![start_server])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

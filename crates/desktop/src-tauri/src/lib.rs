use crate::commands::start_server;

mod commands;

pub struct AppState {
	pub port: std::sync::Mutex<Option<u16>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let _ = fix_path_env::fix();
	tauri::Builder::default()
		.manage(AppState {
			port: std::sync::Mutex::new(None),
		})
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.setup(|app| {
			use tauri::Manager;

			let salt_path = app
				.path()
				.app_local_data_dir()
				.expect("could not resolve app local data path")
				.join("salt.txt");
			app.handle().plugin(
				tauri_plugin_stronghold::Builder::with_argon2(&salt_path)
					.build(),
			)?;

			#[cfg(desktop)]
			{
				app.handle()
					.plugin(tauri_plugin_updater::Builder::new().build())?;
				app.handle().plugin(tauri_plugin_process::init())?;
			}

			#[cfg(not(target_os = "macos"))]
			{
				if let Some(window) = app.handle().get_webview_window("main") {
					let _ = window.set_decorations(false);
				}
			}

			Ok(())
		})
		.invoke_handler(tauri::generate_handler![start_server])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

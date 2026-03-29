use crate::commands::start_server;
use tauri::{Manager, WebviewWindow};
#[cfg(any(windows, target_os = "linux"))]
use tauri_plugin_deep_link::DeepLinkExt;

mod commands;

pub struct AppState {
	pub port: std::sync::Mutex<Option<u16>>,
}

fn focus_main_window(window: &WebviewWindow) {
	let _ = window.show();
	let _ = window.unminimize();
	let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.manage(AppState {
			port: std::sync::Mutex::new(None),
		})
		.plugin(tauri_plugin_deep_link::init())
		.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
			if let Some(window) = app.get_webview_window("main") {
				focus_main_window(&window);
			}
		}))
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.setup(|app| {
			#[cfg(desktop)]
			{
				app.handle()
					.plugin(tauri_plugin_updater::Builder::new().build())?;
				app.handle().plugin(tauri_plugin_process::init())?;

				#[cfg(any(windows, target_os = "linux"))]
				if let Err(error) = app.deep_link().register_all() {
					eprintln!("Failed to register deep-link schemes: {error}");
				}
			}

			Ok(())
		})
		.invoke_handler(tauri::generate_handler![start_server])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

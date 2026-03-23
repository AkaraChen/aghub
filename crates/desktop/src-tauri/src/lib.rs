use tauri::Manager;

use crate::commands::{pick_folder, start_server};

mod commands;

pub struct AppState {
    pub port: std::sync::Mutex<Option<u16>>,
}

unsafe fn setup_window(app: &tauri::App) {
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::{NSColor, NSWindow};
        use cocoa::base::{id, nil, YES};

        let window = app.get_webview_window("main").unwrap();
        let ns_window = window.ns_window().unwrap() as id;

        // Make titlebar transparent using native API
        ns_window.setTitlebarAppearsTransparent_(YES);
        // Set window background color to transparent
        let clear_color = NSColor::colorWithRed_green_blue_alpha_(nil, 0.0, 0.0, 0.0, 0.0);
        ns_window.setBackgroundColor_(clear_color);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            port: std::sync::Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![start_server, pick_folder])
        .setup(|app| {
            unsafe { setup_window(app) };
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

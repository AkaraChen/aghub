use tauri::Emitter;

use crate::commands::start_server;

mod commands;

pub struct AppState {
	pub port: std::sync::Mutex<Option<u16>>,
}

fn is_zh_locale() -> bool {
	#[cfg(target_os = "macos")]
	{
		let output = std::process::Command::new("defaults")
			.args(["read", "-g", "AppleLocale"])
			.output()
			.ok();
		if let Some(out) = output {
			let locale = String::from_utf8_lossy(&out.stdout);
			return locale.trim().starts_with("zh");
		}
	}
	std::env::var("LANG").unwrap_or_default().starts_with("zh")
}

fn build_menu(
	app: &tauri::App,
) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
	use tauri::menu::{Menu, MenuItem, MenuItemKind};

	let menu = Menu::default(app.handle())?;

	#[cfg(target_os = "macos")]
	if let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.first() {
		let _ = app_submenu.remove_at(0);

		let zh = is_zh_locale();
		let about_text = if zh { "关于 aghub" } else { "About aghub" };
		let custom_about =
			MenuItem::with_id(app, "about", about_text, true, None::<&str>)?;

		let _ = app_submenu.insert(&custom_about, 0);
	}

	Ok(menu)
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
			{
				app.handle()
					.plugin(tauri_plugin_updater::Builder::new().build())?;
				app.handle().plugin(tauri_plugin_process::init())?;
			}

			let menu = build_menu(app)?;
			app.set_menu(menu)?;

			Ok(())
		})
		.on_menu_event(|app, event| {
			if event.id().as_ref() == "about" {
				let _ = app.emit("navigate", "/settings?tab=application");
			}
		})
		.invoke_handler(tauri::generate_handler![start_server])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

use crate::commands::{
	clear_log_files, export_diagnostic_logs, get_log_dir_path, get_log_entries,
	get_log_stats, minimize_to_tray, posthog_capture, posthog_get_config,
	posthog_get_distinct_id, posthog_get_session_id, posthog_identify,
	posthog_set_enabled, start_server,
};
use log::info;
use tauri::{Manager, WebviewWindow};

use crate::commands::server::ServerInfo;
use tauri_plugin_log::fern::colors::{Color, ColoredLevelConfig};
use tauri_plugin_log::{
	RotationStrategy, Target, TargetKind, TimezoneStrategy,
};

mod commands;

#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct AppState {
	pub server: std::sync::Mutex<Option<ServerInfo>>,
}

fn default_log_config() -> commands::logging::LogConfig {
	// Read log config from tauri-plugin-store's store.json before Tauri is
	// fully initialized (app handle not yet available).
	let base = if cfg!(target_os = "macos") {
		std::env::var("HOME").ok().map(|h| {
			std::path::PathBuf::from(h).join("Library/Application Support")
		})
	} else if cfg!(target_os = "windows") {
		std::env::var("APPDATA").ok().map(std::path::PathBuf::from)
	} else {
		std::env::var("XDG_DATA_HOME")
			.ok()
			.map(std::path::PathBuf::from)
			.or_else(|| {
				std::env::var("HOME")
					.ok()
					.map(|h| std::path::PathBuf::from(h).join(".local/share"))
			})
	};
	let Some(base) = base else {
		return commands::logging::LogConfig::default();
	};
	let path = base.join("com.akrc.aghub").join("store.json");
	let content = match std::fs::read_to_string(&path) {
		Ok(c) => c,
		Err(_) => return commands::logging::LogConfig::default(),
	};
	let store: serde_json::Value = match serde_json::from_str(&content) {
		Ok(v) => v,
		Err(_) => return commands::logging::LogConfig::default(),
	};
	store
		.get("logConfig")
		.and_then(|v| serde_json::from_value(v.clone()).ok())
		.unwrap_or_default()
}

fn focus_main_window(window: &WebviewWindow) {
	let _ = window.show();
	let _ = window.unminimize();
	let _ = window.set_focus();
}

#[cfg_attr(not(windows), allow(dead_code))]
struct TrayText {
	app_name: &'static str,
	show: &'static str,
	quit: &'static str,
}

#[cfg_attr(not(windows), allow(dead_code))]
fn localized_tray_text() -> TrayText {
	let locale = sys_locale::get_locale()
		.unwrap_or_default()
		.replace('_', "-")
		.to_ascii_lowercase();

	if ["zh-hant", "zh-tw", "zh-hk", "zh-mo"]
		.iter()
		.any(|prefix| locale.starts_with(prefix))
	{
		return TrayText {
			app_name: "aghub",
			show: "顯示 aghub",
			quit: "退出 aghub",
		};
	}

	if locale.starts_with("zh") {
		return TrayText {
			app_name: "aghub",
			show: "显示 aghub",
			quit: "退出 aghub",
		};
	}

	TrayText {
		app_name: "aghub",
		show: "Show aghub",
		quit: "Quit aghub",
	}
}

#[cfg(windows)]
fn restore_main_window(app: &tauri::AppHandle) {
	if let Some(window) = app.get_webview_window("main") {
		focus_main_window(&window);
	}
}

#[cfg(windows)]
fn setup_windows_tray(app: &mut tauri::App) -> tauri::Result<()> {
	use tauri::{
		menu::MenuBuilder,
		tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
	};

	const SHOW_ID: &str = "show";
	const QUIT_ID: &str = "quit";

	let text = localized_tray_text();
	let menu = MenuBuilder::new(app)
		.text(SHOW_ID, text.show)
		.separator()
		.text(QUIT_ID, text.quit)
		.build()?;

	let mut tray = TrayIconBuilder::with_id("main")
		.menu(&menu)
		.show_menu_on_left_click(false)
		.tooltip(text.app_name)
		.on_menu_event(|app, event| match event.id().as_ref() {
			SHOW_ID => restore_main_window(app),
			QUIT_ID => app.exit(0),
			_ => {}
		})
		.on_tray_icon_event(|tray, event| {
			if matches!(
				event,
				TrayIconEvent::DoubleClick {
					button: MouseButton::Left,
					..
				}
			) {
				restore_main_window(tray.app_handle());
			}
		});

	if let Some(icon) = app.default_window_icon().cloned() {
		tray = tray.icon(icon);
	}

	tray.build(app)?;
	Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let _ = fix_path_env::fix();
	let log_config = default_log_config();
	let prefix_colors = ColoredLevelConfig::new()
		.error(Color::Red)
		.warn(Color::Yellow)
		.info(Color::White)
		.debug(Color::White)
		.trace(Color::BrightBlack);
	let level_label_colors = prefix_colors.info(Color::Green);
	tauri::Builder::default()
		.plugin(
			tauri_plugin_log::Builder::new()
				.clear_targets()
				.targets([
					Target::new(TargetKind::Stdout).format(
						move |out, message, record| {
							out.finish(format_args!(
								"{color_line}[{level} {target}] {message}\x1B[0m",
								color_line = format_args!(
									"\x1B[{}m",
									prefix_colors
										.get_color(&record.level())
										.to_fg_str()
								),
								level =
									level_label_colors.color(record.level()),
								target = record.target(),
								message = message,
							));
						},
					),
					Target::new(TargetKind::LogDir {
						file_name: Some("aghub".into()),
					})
					.format(|out, message, record| {
						let now = time::OffsetDateTime::now_local()
							.unwrap_or_else(|_| {
								time::OffsetDateTime::now_utc()
							});
						out.finish(format_args!(
							"{} {} [{}] {}",
							now.format(
								&time::format_description::well_known::Rfc3339,
							)
							.unwrap_or_default(),
							record.level(),
							record.target(),
							message,
						))
					}),
					Target::new(TargetKind::Webview).format(
						|out, message, record| {
							out.finish(format_args!(
								"[{} {}] {}",
								record.level(),
								record.target(),
								message
							))
						},
					),
				])
				// Target-specific formatters already build the final line.
				.format(|out, message, _record| {
					out.finish(format_args!("{message}"))
				})
				.max_file_size(log_config.max_file_size_mb as u128 * 1_048_576)
				.rotation_strategy(RotationStrategy::KeepSome(
					log_config.max_archives as usize,
				))
				.timezone_strategy(TimezoneStrategy::UseLocal)
				.level(log::LevelFilter::Info)
				.build(),
		)
		.manage(AppState {
			server: std::sync::Mutex::new(None),
		})
		.plugin(tauri_plugin_deep_link::init())
		.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
			if let Some(window) = app.get_webview_window("main") {
				focus_main_window(&window);
			}
		}))
		.plugin(tauri_plugin_clipboard_manager::init())
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_store::Builder::default().build())
		.plugin(
			tauri_plugin_autostart::Builder::new()
				.arg("--minimized")
				.build(),
		)
		.on_window_event(|window, event| {
			#[cfg(windows)]
			if window.label() == "main" {
				if let tauri::WindowEvent::CloseRequested { api, .. } = event {
					api.prevent_close();
					let _ = window.hide();
				}
			}

			#[cfg(not(windows))]
			let _ = (window, event);
		})
		.setup(|app| {
			info!("aghub desktop application setup started");
			#[cfg(desktop)]
			{
				app.handle()
					.plugin(tauri_plugin_updater::Builder::new().build())?;
				app.handle().plugin(tauri_plugin_process::init())?;
				info!("desktop updater and process plugins initialized");

				#[cfg(any(windows, target_os = "linux"))]
				{
					use log::{debug, warn};
					use tauri_plugin_deep_link::DeepLinkExt;
					if let Err(error) = app.deep_link().register_all() {
						warn!("failed to register deep-link schemes: {error}");
					} else {
						debug!("registered desktop deep-link schemes");
					}
				}
			}

			#[cfg(not(target_os = "macos"))]
			{
				use tauri::Manager;
				if let Some(window) = app.handle().get_webview_window("main") {
					let _ = window.set_decorations(false);
				}
			}

			#[cfg(windows)]
			{
				setup_windows_tray(app)?;
				if std::env::args().any(|arg| arg == "--minimized") {
					if let Some(window) =
						app.handle().get_webview_window("main")
					{
						let _ = window.hide();
					}
				}
			}

			info!("aghub desktop setup completed");
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			start_server,
			export_diagnostic_logs,
			get_log_dir_path,
			get_log_entries,
			get_log_stats,
			clear_log_files,
			posthog_capture,
			posthog_get_config,
			posthog_identify,
			posthog_get_distinct_id,
			posthog_get_session_id,
			posthog_set_enabled,
			minimize_to_tray,
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

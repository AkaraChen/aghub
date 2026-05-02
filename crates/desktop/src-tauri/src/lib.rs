use crate::commands::{export_diagnostic_logs, get_log_dir_path, start_server};
use log::info;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_log::fern::colors::{Color, ColoredLevelConfig};
use tauri_plugin_log::{
	RotationStrategy, Target, TargetKind, TimezoneStrategy,
};

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
	let _ = fix_path_env::fix();
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
				.max_file_size(10_485_760) // 10 MB
				.rotation_strategy(RotationStrategy::KeepSome(5))
				.timezone_strategy(TimezoneStrategy::UseLocal)
				.level(log::LevelFilter::Info)
				.build(),
		)
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

			info!("aghub desktop setup completed");
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			start_server,
			export_diagnostic_logs,
			get_log_dir_path,
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

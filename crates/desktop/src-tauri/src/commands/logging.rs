use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Serialize)]
struct LogManifest {
	app_version: String,
	os: String,
	arch: String,
	timestamp: String,
	log_files: Vec<String>,
	total_log_size_bytes: u64,
}

fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
	app.path()
		.app_log_dir()
		.map_err(|e| format!("failed to resolve log directory: {e}"))
}

fn collect_log_files(dir: &PathBuf) -> Vec<PathBuf> {
	let Ok(entries) = fs::read_dir(dir) else {
		return Vec::new();
	};
	entries
		.filter_map(Result::ok)
		.map(|e| e.path())
		.filter(|p| p.extension().is_some_and(|ext| ext == "log"))
		.collect()
}

#[tauri::command]
pub async fn export_diagnostic_logs(
	app: tauri::AppHandle,
) -> Result<String, String> {
	let log_dir = log_dir(&app)?;
	let log_files = collect_log_files(&log_dir);

	let version = app
		.config()
		.version
		.clone()
		.unwrap_or_else(|| "unknown".to_string());

	let now = time::OffsetDateTime::now_local()
		.unwrap_or_else(|_| time::OffsetDateTime::now_utc());
	let date_str = now
		.format(&time::format_description::well_known::Iso8601::DATE)
		.unwrap_or_else(|_| "unknown".to_string());

	let zip_name = format!("aghub-logs-{date_str}.zip");
	let zip_path = log_dir.join(&zip_name);

	let file = fs::File::create(&zip_path)
		.map_err(|e| format!("failed to create zip: {e}"))?;
	let mut zip = ZipWriter::new(file);
	let options = SimpleFileOptions::default()
		.compression_method(zip::CompressionMethod::Deflated);

	let mut total_size: u64 = 0;
	let mut file_names: Vec<String> = Vec::new();

	for path in &log_files {
		let name = path
			.file_name()
			.map(|n| n.to_string_lossy().to_string())
			.unwrap_or_default();
		let entry_path = format!("logs/{name}");

		let mut buf = Vec::new();
		if let Ok(mut f) = fs::File::open(path) {
			let _ = f.read_to_end(&mut buf);
		}
		total_size += buf.len() as u64;
		file_names.push(name);

		zip.start_file(&entry_path, options)
			.map_err(|e| format!("zip error: {e}"))?;
		zip.write_all(&buf)
			.map_err(|e| format!("zip write error: {e}"))?;
	}

	let manifest = LogManifest {
		app_version: version,
		os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
		arch: std::env::consts::ARCH.to_string(),
		timestamp: now
			.format(&time::format_description::well_known::Rfc3339)
			.unwrap_or_default(),
		log_files: file_names,
		total_log_size_bytes: total_size,
	};
	let manifest_json = serde_json::to_string_pretty(&manifest)
		.map_err(|e| format!("manifest serialize error: {e}"))?;

	zip.start_file("manifest.json", options)
		.map_err(|e| format!("zip error: {e}"))?;
	zip.write_all(manifest_json.as_bytes())
		.map_err(|e| format!("zip write error: {e}"))?;

	zip.finish().map_err(|e| format!("zip finish error: {e}"))?;

	Ok(zip_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_log_dir_path(app: tauri::AppHandle) -> Result<String, String> {
	log_dir(&app).map(|p| p.to_string_lossy().to_string())
}

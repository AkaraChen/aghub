use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
#[cfg(not(target_os = "linux"))]
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Serialize)]
struct LogManifest {
	app_version: String,
	tauri_version: &'static str,
	os: String,
	os_version: String,
	arch: String,
	log_level: String,
	timestamp: String,
	log_files: Vec<String>,
	total_log_size_bytes: u64,
}

fn os_version() -> String {
	#[cfg(target_os = "macos")]
	{
		Command::new("sw_vers")
			.arg("-productVersion")
			.output()
			.ok()
			.and_then(|o| String::from_utf8(o.stdout).ok())
			.map(|s| format!("macOS {}", s.trim()))
			.unwrap_or_default()
	}
	#[cfg(target_os = "windows")]
	{
		Command::new("cmd")
			.args(["/C", "ver"])
			.creation_flags(crate::CREATE_NO_WINDOW)
			.output()
			.ok()
			.and_then(|o| String::from_utf8(o.stdout).ok())
			.map(|s| s.trim().to_string())
			.unwrap_or_default()
	}
	#[cfg(target_os = "linux")]
	{
		fs::read_to_string("/etc/os-release")
			.ok()
			.and_then(|content| {
				content.lines().find(|l| l.starts_with("PRETTY_NAME=")).map(
					|l| {
						l.trim_start_matches("PRETTY_NAME=")
							.trim_matches('"')
							.to_string()
					},
				)
			})
			.unwrap_or_default()
	}
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
	save_path: String,
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

	let file = fs::File::create(&save_path)
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
		tauri_version: tauri::VERSION,
		os: std::env::consts::OS.to_string(),
		os_version: os_version(),
		arch: std::env::consts::ARCH.to_string(),
		log_level: log::max_level().to_string(),
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

	Ok(save_path)
}

#[tauri::command]
pub async fn get_log_dir_path(app: tauri::AppHandle) -> Result<String, String> {
	log_dir(&app).map(|p| p.to_string_lossy().to_string())
}

// -- Log viewer commands --

#[derive(Serialize, Clone)]
pub struct LogEntry {
	pub timestamp: String,
	pub level: String,
	pub target: String,
	pub message: String,
}

fn parse_log_line(line: &str) -> Option<LogEntry> {
	// Format: "{rfc3339} {LEVEL} [{target}] {message}"
	let (timestamp, rest) = line.split_once(' ')?;
	let (level, rest) = rest.split_once(' ')?;
	let rest = rest.strip_prefix('[')?;
	let (target, message) = rest.split_once("] ")?;
	Some(LogEntry {
		timestamp: timestamp.to_string(),
		level: level.to_string(),
		target: target.to_string(),
		message: message.to_string(),
	})
}

fn read_all_entries(log_dir: &PathBuf) -> Vec<LogEntry> {
	let mut files = collect_log_files(log_dir);
	files.sort();
	let mut entries = Vec::new();
	for path in &files {
		let Ok(file) = fs::File::open(path) else {
			continue;
		};
		for line in BufReader::new(file).lines().map_while(Result::ok) {
			if let Some(entry) = parse_log_line(&line) {
				entries.push(entry);
			}
		}
	}
	entries
}

#[derive(Deserialize)]
pub struct GetLogEntriesParams {
	pub offset: Option<usize>,
	pub limit: Option<usize>,
	pub level_filter: Option<Vec<String>>,
	pub search: Option<String>,
}

#[derive(Serialize)]
pub struct GetLogEntriesResponse {
	pub entries: Vec<LogEntry>,
	pub total_count: usize,
	pub has_more: bool,
}

#[tauri::command]
pub async fn get_log_entries(
	app: tauri::AppHandle,
	params: GetLogEntriesParams,
) -> Result<GetLogEntriesResponse, String> {
	let log_dir = log_dir(&app)?;
	let all = read_all_entries(&log_dir);

	let filtered: Vec<&LogEntry> = all
		.iter()
		.filter(|e| {
			if let Some(levels) = &params.level_filter {
				if !levels.is_empty()
					&& !levels.iter().any(|l| l.eq_ignore_ascii_case(&e.level))
				{
					return false;
				}
			}
			if let Some(search) = &params.search {
				if !search.is_empty() {
					let s = search.to_lowercase();
					return e.message.to_lowercase().contains(&s)
						|| e.target.to_lowercase().contains(&s);
				}
			}
			true
		})
		.collect();

	let total_count = filtered.len();
	let offset = params.offset.unwrap_or(0);
	let limit = params.limit.unwrap_or(200);
	let entries: Vec<LogEntry> = filtered
		.into_iter()
		.skip(offset)
		.take(limit)
		.cloned()
		.collect();
	let has_more = offset + entries.len() < total_count;

	Ok(GetLogEntriesResponse {
		entries,
		total_count,
		has_more,
	})
}

#[derive(Serialize)]
pub struct LogStats {
	pub total_entries: usize,
	pub entries_by_level: std::collections::HashMap<String, usize>,
	pub log_files: Vec<String>,
	pub total_size_bytes: u64,
	pub log_dir_path: String,
}

#[tauri::command]
pub async fn get_log_stats(app: tauri::AppHandle) -> Result<LogStats, String> {
	let dir = log_dir(&app)?;
	let files = collect_log_files(&dir);
	let mut total_size = 0u64;
	let mut file_names = Vec::new();
	for path in &files {
		if let Ok(meta) = fs::metadata(path) {
			total_size += meta.len();
		}
		if let Some(name) = path.file_name() {
			file_names.push(name.to_string_lossy().to_string());
		}
	}

	// Count entries and levels in a single pass without full parsing.
	let mut total_entries = 0usize;
	let mut entries_by_level = std::collections::HashMap::new();
	for path in &files {
		let Ok(file) = fs::File::open(path) else {
			continue;
		};
		for line in BufReader::new(file).lines().map_while(Result::ok) {
			// Extract level from format: "{timestamp} {LEVEL} [{target}] {msg}"
			if let Some(rest) = line.split_once(' ').map(|(_, r)| r) {
				if let Some(level) = rest.split_once(' ').map(|(l, _)| l) {
					total_entries += 1;
					*entries_by_level
						.entry(level.to_string())
						.or_insert(0usize) += 1;
				}
			}
		}
	}

	Ok(LogStats {
		total_entries,
		entries_by_level,
		log_files: file_names,
		total_size_bytes: total_size,
		log_dir_path: dir.to_string_lossy().to_string(),
	})
}

// -- Log management commands --

#[tauri::command]
pub async fn clear_log_files(app: tauri::AppHandle) -> Result<usize, String> {
	let dir = log_dir(&app)?;
	let files = collect_log_files(&dir);
	let mut cleared = 0;
	for path in &files {
		let is_current = path.file_name().is_some_and(|n| n == "aghub.log");
		if is_current {
			// Truncate the current file instead of deleting it,
			// because tauri-plugin-log holds the file handle open.
			if fs::write(path, b"").is_ok() {
				cleared += 1;
			}
		} else if fs::remove_file(path).is_ok() {
			cleared += 1;
		}
	}
	Ok(cleared)
}

/// Log rotation config read from `store.json` at startup.
#[derive(Serialize, Deserialize, Clone)]
pub struct LogConfig {
	pub max_file_size_mb: u32,
	pub max_archives: u32,
}

impl Default for LogConfig {
	fn default() -> Self {
		Self {
			max_file_size_mb: 10,
			max_archives: 5,
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_valid_log_line() {
		let line =
			"2026-05-02T15:19:03.970+08:00 INFO [aghub_api] api request started: GET /api/v1/agents";
		let entry = parse_log_line(line).unwrap();
		assert_eq!(entry.timestamp, "2026-05-02T15:19:03.970+08:00");
		assert_eq!(entry.level, "INFO");
		assert_eq!(entry.target, "aghub_api");
		assert_eq!(entry.message, "api request started: GET /api/v1/agents");
	}

	#[test]
	fn parse_warn_level() {
		let line = "2026-05-02T10:00:00Z WARN [rocket::server] something wrong";
		let entry = parse_log_line(line).unwrap();
		assert_eq!(entry.level, "WARN");
		assert_eq!(entry.target, "rocket::server");
		assert_eq!(entry.message, "something wrong");
	}

	#[test]
	fn parse_message_with_brackets() {
		let line =
			"2026-05-02T10:00:00Z INFO [target] [nested] bracket content";
		let entry = parse_log_line(line).unwrap();
		assert_eq!(entry.target, "target");
		assert_eq!(entry.message, "[nested] bracket content");
	}

	#[test]
	fn parse_invalid_line_returns_none() {
		assert!(parse_log_line("").is_none());
		assert!(parse_log_line("no format here").is_none());
		assert!(parse_log_line("2026-05-02 INFO missing brackets").is_none());
	}

	#[test]
	fn collect_log_files_filters_by_extension() {
		let dir = tempfile::tempdir().unwrap();
		fs::write(dir.path().join("aghub.log"), "log1").unwrap();
		fs::write(dir.path().join("aghub_old.log"), "log2").unwrap();
		fs::write(dir.path().join("store.json"), "{}").unwrap();
		fs::write(dir.path().join("notes.txt"), "text").unwrap();

		let files = collect_log_files(&dir.path().to_path_buf());
		let names: Vec<String> = files
			.iter()
			.filter_map(|p| p.file_name())
			.map(|n| n.to_string_lossy().to_string())
			.collect();
		assert!(names.contains(&"aghub.log".to_string()));
		assert!(names.contains(&"aghub_old.log".to_string()));
		assert!(!names.contains(&"store.json".to_string()));
		assert!(!names.contains(&"notes.txt".to_string()));
	}

	#[test]
	fn os_version_returns_non_empty() {
		let version = os_version();
		assert!(!version.is_empty(), "os_version() should not be empty");
	}

	#[test]
	fn read_all_entries_from_temp_dir() {
		let dir = tempfile::tempdir().unwrap();
		fs::write(
			dir.path().join("aghub.log"),
			"2026-05-02T10:00:00Z INFO [app] line one\n\
			 2026-05-02T10:00:01Z WARN [app] line two\n\
			 invalid line\n",
		)
		.unwrap();

		let entries = read_all_entries(&dir.path().to_path_buf());
		assert_eq!(entries.len(), 2);
		assert_eq!(entries[0].level, "INFO");
		assert_eq!(entries[1].level, "WARN");
	}
}

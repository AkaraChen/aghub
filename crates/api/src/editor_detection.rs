use which::which;

use crate::dto::integrations::{CodeEditorType, EditorDescriptor, ToolInfoDto};

impl From<&CodeEditorType> for ToolInfoDto {
	fn from(editor: &CodeEditorType) -> Self {
		let desc = editor.descriptor();
		let (installed, path) = detect_editor(&desc);

		Self {
			id: serde_json::to_string(editor)
				.unwrap_or_default()
				.trim_matches('"')
				.to_string(),
			name: desc.display_name.to_string(),
			installed,
			path,
		}
	}
}

pub fn detect_any_installed_editor() -> Option<CodeEditorType> {
	CodeEditorType::all()
		.iter()
		.find(|editor| detect_editor(&editor.descriptor()).0)
		.cloned()
}

fn detect_editor(desc: &EditorDescriptor) -> (bool, Option<String>) {
	if let Some(path) = detect_platform_path(desc) {
		return (true, Some(path));
	}

	if let Ok(p) = which(desc.cli_command) {
		return (true, Some(p.to_string_lossy().to_string()));
	}

	(false, None)
}

#[cfg(target_os = "macos")]
fn detect_platform_path(desc: &EditorDescriptor) -> Option<String> {
	use std::path::PathBuf;

	let search_dirs = [
		PathBuf::from("/Applications"),
		dirs::home_dir()
			.map(|h| h.join("Applications"))
			.unwrap_or_else(|| PathBuf::from("/Applications")),
	];

	for app_name in desc.macos_app_names {
		for dir in &search_dirs {
			let app_path = dir.join(app_name);
			if app_path.exists() {
				return Some(app_path.to_string_lossy().to_string());
			}
		}
	}
	None
}

#[cfg(target_os = "windows")]
fn detect_platform_path(desc: &EditorDescriptor) -> Option<String> {
	for template in desc.windows_exe_paths {
		let expanded = expand_env_var_placeholders(template, |name| {
			std::env::var(name).ok()
		});
		let path = std::path::Path::new(&expanded);
		if path.exists() {
			return Some(expanded);
		}
	}
	None
}

#[cfg(target_os = "linux")]
fn detect_platform_path(desc: &EditorDescriptor) -> Option<String> {
	for bin_path in desc.linux_bin_paths {
		if std::path::Path::new(bin_path).exists() {
			return Some((*bin_path).to_string());
		}
	}

	for app_id in desc.linux_flatpak_ids {
		let ok = std::process::Command::new("flatpak")
			.args(["info", app_id])
			.stdout(std::process::Stdio::null())
			.stderr(std::process::Stdio::null())
			.status()
			.map(|s| s.success())
			.unwrap_or(false);
		if ok {
			return Some(format!("flatpak::{}", app_id));
		}
	}

	None
}

#[cfg(not(any(
	target_os = "macos",
	target_os = "windows",
	target_os = "linux"
)))]
fn detect_platform_path(_desc: &EditorDescriptor) -> Option<String> {
	None
}

#[cfg(any(target_os = "windows", test))]
fn expand_env_var_placeholders(
	template: &str,
	resolve: impl Fn(&str) -> Option<String>,
) -> String {
	let mut result = template.to_string();
	for var_name in [
		"LOCALAPPDATA",
		"APPDATA",
		"ProgramFiles",
		"ProgramFiles(x86)",
		"USERPROFILE",
		"SystemDrive",
	] {
		let placeholder = format!("%{}%", var_name);
		if result.contains(&placeholder) {
			if let Some(value) = resolve(var_name) {
				result = result.replace(&placeholder, &value);
			}
		}
	}
	result
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_all_editors_have_cli_command() {
		for editor in CodeEditorType::all() {
			assert!(!editor.descriptor().cli_command.is_empty());
		}
	}

	#[test]
	fn test_all_editors_have_display_name() {
		for editor in CodeEditorType::all() {
			assert!(!editor.descriptor().display_name.is_empty());
		}
	}

	#[test]
	fn test_expand_env_var_placeholders() {
		let expanded = expand_env_var_placeholders(
			"%LOCALAPPDATA%\\Programs\\Code\\Code.exe",
			|name| match name {
				"LOCALAPPDATA" => {
					Some("C:\\Users\\test\\AppData\\Local".to_string())
				}
				_ => None,
			},
		);
		assert_eq!(
			expanded,
			"C:\\Users\\test\\AppData\\Local\\Programs\\Code\\Code.exe"
		);
	}

	#[test]
	fn test_expand_unknown_var_left_as_is() {
		let expanded =
			expand_env_var_placeholders("%UNKNOWN%\\something", |_| None);
		assert_eq!(expanded, "%UNKNOWN%\\something");
	}
}

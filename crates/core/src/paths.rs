use std::path::{Path, PathBuf};

// Keep individual path functions for backward compatibility with adapters
pub fn claude_global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".claude.json")
}
pub fn claude_global_skills_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".claude/skills")
}
pub fn claude_project_path(root: &Path) -> PathBuf {
	root.join(".mcp.json")
}
pub fn opencode_global_path() -> PathBuf {
	#[cfg(any(target_os = "macos", target_os = "linux"))]
	return dirs::home_dir()
		.unwrap()
		.join(".config/opencode/opencode.json");
	#[cfg(target_os = "windows")]
	return dirs::data_dir().unwrap().join("opencode/opencode.json");
}
pub fn opencode_project_path(root: &Path) -> PathBuf {
	root.join(".opencode/settings.json")
}
pub fn cursor_global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".cursor/mcp.json")
}
pub fn cursor_project_path(root: &Path) -> PathBuf {
	root.join(".cursor/mcp.json")
}
pub fn codex_global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".codex/config.toml")
}
pub fn codex_project_path(root: &Path) -> PathBuf {
	root.join(".codex/config.toml")
}
pub fn antigravity_global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap()
		.join(".gemini/antigravity/mcp_config.json")
}
pub fn antigravity_project_path(root: &Path) -> PathBuf {
	root.join(".gemini/antigravity/mcp_config.json")
}
pub fn openclaw_global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".openclaw/openclaw.json")
}
pub fn openclaw_project_path(root: &Path) -> PathBuf {
	root.join(".openclaw/openclaw.json")
}
pub fn windsurf_global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap()
		.join(".codeium/windsurf/mcp_config.json")
}
pub fn windsurf_project_path(root: &Path) -> PathBuf {
	root.join(".windsurf/mcp_config.json")
}
pub fn roocode_global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".roo/mcp.json")
}
pub fn roocode_project_path(root: &Path) -> PathBuf {
	root.join(".roo/mcp.json")
}
pub fn copilot_global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".vscode/mcp.json")
}
pub fn copilot_project_path(root: &Path) -> PathBuf {
	root.join(".vscode/mcp.json")
}
pub fn cline_global_path() -> PathBuf {
	dirs::home_dir()
		.unwrap()
		.join(".cline/data/settings/cline_mcp_settings.json")
}
pub fn cline_project_path(root: &Path) -> PathBuf {
	root.join(".cline/mcp.json")
}
pub fn gemini_global_path() -> PathBuf {
	dirs::home_dir().unwrap().join(".gemini/settings.json")
}
pub fn gemini_project_path(root: &Path) -> PathBuf {
	root.join(".gemini/settings.json")
}

/// Check if a project config exists for the given agent (data-driven via registry)
pub fn project_config_exists(
	agent_type: super::AgentType,
	project_root: &Path,
) -> bool {
	let descriptor = crate::registry::get(agent_type);
	(descriptor.project_path)(project_root).exists()
}

/// Find the project root by checking registry markers (data-driven)
pub fn find_project_root(start_dir: &Path) -> Option<PathBuf> {
	let mut current = Some(start_dir);

	while let Some(dir) = current {
		// Check all agent project markers from registry
		for descriptor in crate::registry::iter_all() {
			for marker in descriptor.project_markers {
				let marker_path = dir.join(marker);
				if marker_path.exists() {
					return Some(dir.to_path_buf());
				}
			}
		}

		// Also check for .git as a fallback (only if any agent marker exists)
		if dir.join(".git").is_dir() {
			for descriptor in crate::registry::iter_all() {
				for marker in descriptor.project_markers {
					if dir.join(marker).exists() {
						return Some(dir.to_path_buf());
					}
				}
			}
		}

		current = dir.parent();
	}

	None
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::fs;
	use tempfile::TempDir;

	#[test]
	fn test_claude_global_path_format() {
		let path = claude_global_path();
		let path_str = path.to_string_lossy();
		assert!(path_str.contains(".claude.json"));
		assert!(!path_str.contains("Library/Application Support"));
	}

	#[test]
	fn test_claude_project_path() {
		let project = PathBuf::from("/home/user/myproject");
		let path = claude_project_path(&project);
		assert_eq!(path, PathBuf::from("/home/user/myproject/.mcp.json"));
	}

	#[test]
	fn test_find_project_root_with_claude() {
		let temp_dir = TempDir::new().unwrap();
		let project_root = temp_dir.path().join("myproject");
		fs::create_dir_all(&project_root).unwrap();
		fs::write(project_root.join(".mcp.json"), "{}").unwrap();
		let found = find_project_root(&project_root).unwrap();
		assert_eq!(found, project_root);
	}

	#[test]
	fn test_find_project_root_with_opencode() {
		let temp_dir = TempDir::new().unwrap();
		let project_root = temp_dir.path().join("myproject");
		let opencode_dir = project_root.join(".opencode");
		fs::create_dir_all(&opencode_dir).unwrap();
		let found = find_project_root(&project_root).unwrap();
		assert_eq!(found, project_root);
	}

	#[test]
	fn test_find_project_root_nested() {
		let temp_dir = TempDir::new().unwrap();
		let project_root = temp_dir.path().join("myproject");
		fs::create_dir_all(&project_root).unwrap();
		fs::write(project_root.join(".mcp.json"), "{}").unwrap();
		let nested_dir = project_root.join("src/components");
		fs::create_dir_all(&nested_dir).unwrap();
		let found = find_project_root(&nested_dir).unwrap();
		assert_eq!(found, project_root);
	}

	#[test]
	fn test_project_config_exists() {
		let temp_dir = TempDir::new().unwrap();
		fs::write(temp_dir.path().join(".mcp.json"), "{}").unwrap();
		assert!(project_config_exists(
			super::super::AgentType::Claude,
			temp_dir.path()
		));
	}

	#[test]
	fn test_external_agent_paths_are_correct() {
		let dir = Path::new("/test_project");
		assert_eq!(
			cursor_project_path(dir).to_str().unwrap(),
			"/test_project/.cursor/mcp.json"
		);
		assert_eq!(
			windsurf_project_path(dir).to_str().unwrap(),
			"/test_project/.windsurf/mcp_config.json"
		);
		assert_eq!(
			copilot_project_path(dir).to_str().unwrap(),
			"/test_project/.vscode/mcp.json"
		);
		assert_eq!(
			roocode_project_path(dir).to_str().unwrap(),
			"/test_project/.roo/mcp.json"
		);
		assert_eq!(
			gemini_project_path(dir).to_str().unwrap(),
			"/test_project/.gemini/settings.json"
		);
		assert_eq!(
			codex_project_path(dir).to_str().unwrap(),
			"/test_project/.codex/config.toml"
		);
		assert_eq!(
			antigravity_project_path(dir).to_str().unwrap(),
			"/test_project/.gemini/antigravity/mcp_config.json"
		);
		assert_eq!(
			openclaw_project_path(dir).to_str().unwrap(),
			"/test_project/.openclaw/openclaw.json"
		);
		assert_eq!(
			cline_project_path(dir).to_str().unwrap(),
			"/test_project/.cline/mcp.json"
		);
	}
}

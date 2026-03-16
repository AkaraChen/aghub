use std::path::{Path, PathBuf};

/// Get the global configuration path for Claude Code CLI
/// Uses ~/.claude.json on all platforms for MCP server configurations
pub fn claude_global_path() -> PathBuf {
	dirs::home_dir()
		.expect("Could not determine home directory")
		.join(".claude.json")
}

/// Get the global skills directory path for Claude Code CLI
/// Uses ~/.claude/skills/ on all platforms
pub fn claude_global_skills_path() -> PathBuf {
	dirs::home_dir()
		.expect("Could not determine home directory")
		.join(".claude/skills")
}

/// Get the project configuration path for Claude Code
/// Claude Code project-scoped MCP servers are conventionally kept in .mcp.json
pub fn claude_project_path(project_root: &Path) -> PathBuf {
	project_root.join(".mcp.json")
}

/// Get the global configuration path for OpenCode
pub fn opencode_global_path() -> PathBuf {
	#[cfg(target_os = "macos")]
	return dirs::home_dir()
		.expect("Could not determine home directory")
		.join(".config/opencode/opencode.json");

	#[cfg(target_os = "linux")]
	return dirs::home_dir()
		.expect("Could not determine home directory")
		.join(".config/opencode/opencode.json");

	#[cfg(target_os = "windows")]
	return dirs::data_dir()
		.expect("Could not determine data directory")
		.join("opencode/opencode.json");
}

/// Get the project configuration path for OpenCode
pub fn opencode_project_path(project_root: &Path) -> PathBuf {
	project_root.join(".opencode/settings.json")
}

/// Check if a project config exists for the given agent
pub fn project_config_exists(
	agent_type: super::AgentType,
	project_root: &Path,
) -> bool {
	let path = match agent_type {
		super::AgentType::Claude => claude_project_path(project_root),
		super::AgentType::OpenCode => opencode_project_path(project_root),
	};
	path.exists()
}

/// Find the project root by looking for .claude or .opencode directories
pub fn find_project_root(start_dir: &Path) -> Option<PathBuf> {
	let mut current = Some(start_dir);

	while let Some(dir) = current {
		// Check for either .claude, .opencode dirs, or .mcp.json file
		if dir.join(".claude").is_dir()
			|| dir.join(".opencode").is_dir()
			|| dir.join(".mcp.json").is_file()
		{
			return Some(dir.to_path_buf());
		}

		// Also check for .git as a fallback
		if dir.join(".git").is_dir() {
			// Check if there's a .claude, .opencode, or .mcp.json in this git root
			if dir.join(".claude").is_dir()
				|| dir.join(".opencode").is_dir()
				|| dir.join(".mcp.json").is_file()
			{
				return Some(dir.to_path_buf());
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
		// Should NOT contain Library/Application Support (that's Claude Desktop)
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
}

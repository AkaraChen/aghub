use std::path::{Path, PathBuf};

/// Check if a project config exists for the given agent (data-driven via registry)
pub fn project_config_exists(
	agent_type: super::AgentType,
	project_root: &Path,
) -> bool {
	let adapter = crate::create_adapter(agent_type);
	adapter
		.mcp_config_path(Some(project_root), crate::ResourceScope::ProjectOnly)
		.is_some_and(|path| path.exists())
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
		let descriptor = crate::registry::get(super::super::AgentType::Claude);
		let path = descriptor
			.mcp_global_path
			.and_then(|path| path())
			.expect("Claude should have a global MCP path");
		let path_str = path.to_string_lossy();
		assert!(path_str.contains(".claude.json"));
		assert!(!path_str.contains("Library/Application Support"));
	}

	#[test]
	fn test_claude_project_path() {
		let project = PathBuf::from("/home/user/myproject");
		let descriptor = crate::registry::get(super::super::AgentType::Claude);
		let path = descriptor
			.mcp_project_path
			.and_then(|path| path(&project))
			.expect("Claude should have a project MCP path");
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
		let cursor = crate::registry::get(super::super::AgentType::Cursor);
		let windsurf = crate::registry::get(super::super::AgentType::Windsurf);
		let copilot = crate::registry::get(super::super::AgentType::Copilot);
		let roocode = crate::registry::get(super::super::AgentType::RooCode);
		let gemini = crate::registry::get(super::super::AgentType::Gemini);
		let codex = crate::registry::get(super::super::AgentType::Codex);
		let kimi = crate::registry::get(super::super::AgentType::Kimi);
		let antigravity =
			crate::registry::get(super::super::AgentType::Antigravity);
		let openclaw = crate::registry::get(super::super::AgentType::Openclaw);
		let cline = crate::registry::get(super::super::AgentType::Cline);

		assert_eq!(
			cursor
				.mcp_project_path
				.and_then(|path| path(dir))
				.expect("Cursor should have a project MCP path"),
			dir.join(".cursor/mcp.json")
		);
		assert_eq!(
			windsurf
				.mcp_project_path
				.and_then(|path| path(dir))
				.expect("Windsurf should have a project MCP path"),
			dir.join(".windsurf/mcp_config.json")
		);
		assert_eq!(
			copilot
				.mcp_project_path
				.and_then(|path| path(dir))
				.expect("Copilot should have a project MCP path"),
			dir.join(".vscode/mcp.json")
		);
		assert_eq!(
			roocode
				.mcp_project_path
				.and_then(|path| path(dir))
				.expect("RooCode should have a project MCP path"),
			dir.join(".roo/mcp.json")
		);
		assert_eq!(
			gemini
				.mcp_project_path
				.and_then(|path| path(dir))
				.expect("Gemini should have a project MCP path"),
			dir.join(".gemini/settings.json")
		);
		assert_eq!(
			kimi.mcp_project_path
				.and_then(|path| path(dir))
				.expect("Kimi should have a project MCP path"),
			dir.join(".kimi/mcp.json")
		);
		assert_eq!(
			codex
				.mcp_project_path
				.and_then(|path| path(dir))
				.expect("Codex should have a project MCP path"),
			dir.join(".codex/config.toml")
		);
		assert_eq!(
			antigravity
				.mcp_project_path
				.and_then(|path| path(dir))
				.expect("Antigravity should have a project MCP path"),
			dir.join(".gemini/antigravity/mcp_config.json")
		);
		assert!(openclaw.mcp_project_path.is_none());
		assert_eq!(
			cline
				.mcp_project_path
				.and_then(|path| path(dir))
				.expect("Cline should have a project MCP path"),
			dir.join(".cline/mcp.json")
		);
	}
}

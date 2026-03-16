use std::path::{Path, PathBuf};

/// Get the global configuration path for Claude Code CLI
/// Uses ~/.claude/settings.json on all platforms (NOT Claude Desktop)
pub fn claude_global_path() -> PathBuf {
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".claude/settings.json")
}

/// Get the global skills directory path for Claude Code CLI
/// Uses ~/.claude/skills/ on all platforms
pub fn claude_global_skills_path() -> PathBuf {
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".claude/skills")
}

/// Get the project configuration path for Claude Code
pub fn claude_project_path(project_root: &Path) -> PathBuf {
    project_root.join(".claude/settings.json")
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
pub fn project_config_exists(agent_type: super::AgentType, project_root: &Path) -> bool {
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
        // Check for either .claude or .opencode
        if dir.join(".claude").is_dir() || dir.join(".opencode").is_dir() {
            return Some(dir.to_path_buf());
        }

        // Also check for .git as a fallback
        if dir.join(".git").is_dir() {
            // Check if there's a .claude or .opencode in this git root
            if dir.join(".claude").is_dir() || dir.join(".opencode").is_dir() {
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
        assert!(path_str.contains(".claude/settings.json"));
        // Should NOT contain Library/Application Support (that's Claude Desktop)
        assert!(!path_str.contains("Library/Application Support"));
    }

    #[test]
    fn test_claude_project_path() {
        let project = PathBuf::from("/home/user/myproject");
        let path = claude_project_path(&project);
        assert_eq!(
            path,
            PathBuf::from("/home/user/myproject/.claude/settings.json")
        );
    }

    #[test]
    fn test_find_project_root_with_claude() {
        let temp_dir = TempDir::new().unwrap();
        let project_root = temp_dir.path().join("myproject");
        let claude_dir = project_root.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();

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
        let claude_dir = project_root.join(".claude");
        let nested_dir = project_root.join("src/components");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::create_dir_all(&nested_dir).unwrap();

        let found = find_project_root(&nested_dir).unwrap();
        assert_eq!(found, project_root);
    }

    #[test]
    fn test_project_config_exists() {
        let temp_dir = TempDir::new().unwrap();
        let claude_dir = temp_dir.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(claude_dir.join("settings.json"), "{}").unwrap();

        assert!(project_config_exists(
            super::super::AgentType::Claude,
            temp_dir.path()
        ));
    }
}

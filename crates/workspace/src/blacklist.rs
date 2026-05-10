/// Per-agent directory blacklists. Each agent has its own curated list
/// based on its actual directory structure. Only directories are matched
/// by exact name — no regex, no glob patterns.
///
/// Agents without a blacklist entry show all their directories unfiltered.
fn blacklist_for(agent_id: &str) -> Option<&'static [&'static str]> {
	match agent_id {
		"claude" => Some(&[
			"backups",
			"cache",
			"debug",
			"file-history",
			"ide",
			"image-cache",
			"paste-cache",
			"session-env",
			"sessions",
			"shell-snapshots",
			"statsig",
			"telemetry",
			"todos",
			"transcripts",
			"worktrees",
		]),
		"codex" => Some(&[
			".tmp",
			"ambient-suggestions",
			"archived_sessions",
			"cache",
			"log",
			"sessions",
			"shell_snapshots",
			"sqlite",
			"tmp",
			"vendor_imports",
			"worktrees",
		]),
		"opencode" => Some(&["node_modules"]),
		"openclaw" => Some(&[
			"browser",
			"canvas",
			"completions",
			"credentials",
			"cron",
			"delivery-queue",
			"devices",
			"identity",
			"logs",
			"settings",
			"telegram",
			"workspace",
		]),
		"cursor" => Some(&["extensions"]),
		"windsurf" => Some(&["extensions"]),
		"kimi" => Some(&["credentials", "logs", "sessions", "user-history"]),
		_ => None,
	}
}

/// Root-level file extensions recognized as browsable config files.
const CONFIG_EXTENSIONS: &[&str] =
	&["json", "jsonc", "toml", "md", "yaml", "yml"];

/// Single entry point for scanner filtering.
/// - Dot entries hidden at all levels
/// - Blacklist + config file extension check only at root (depth 0)
/// - Sub-directories show everything
pub fn is_visible(
	name: &str,
	is_dir: bool,
	agent_id: &str,
	depth: usize,
) -> bool {
	if name.starts_with('.') {
		return false;
	}
	if depth > 0 {
		return true;
	}
	if is_dir {
		return match blacklist_for(agent_id) {
			Some(list) => !list.contains(&name),
			None => true,
		};
	}
	name.rsplit('.')
		.next()
		.is_some_and(|ext| CONFIG_EXTENSIONS.contains(&ext))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn root_dirs_filtered_by_agent() {
		assert!(!is_visible("cache", true, "claude", 0));
		assert!(!is_visible("sessions", true, "claude", 0));
		assert!(is_visible("skills", true, "claude", 0));
		assert!(!is_visible("cache", true, "codex", 0));
		assert!(!is_visible("browser", true, "openclaw", 0));
		assert!(is_visible("agents", true, "openclaw", 0));
	}

	#[test]
	fn root_files_filtered_by_extension() {
		assert!(is_visible("settings.json", false, "claude", 0));
		assert!(is_visible("CLAUDE.md", false, "claude", 0));
		assert!(!is_visible("history.jsonl", false, "claude", 0));
		assert!(!is_visible("settings.json.backup", false, "claude", 0));
	}

	#[test]
	fn dot_entries_always_hidden() {
		assert!(!is_visible(".git", true, "claude", 0));
		assert!(!is_visible(".env", false, "claude", 0));
		assert!(!is_visible(".git", true, "claude", 1));
	}

	#[test]
	fn sub_dirs_always_visible() {
		assert!(is_visible("cache", true, "claude", 1));
		assert!(is_visible("anything", false, "codex", 1));
	}

	#[test]
	fn unadapted_agent_no_dir_filtering() {
		assert!(is_visible("cache", true, "gemini", 0));
		assert!(is_visible("settings.json", false, "gemini", 0));
	}
}

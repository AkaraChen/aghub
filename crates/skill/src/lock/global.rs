use chrono::Utc;
use std::collections::BTreeMap;

use super::{io, types};

pub use io::{get_skill_lock_path, read_skill_lock, write_skill_lock};
pub use types::{DismissedPrompts, SkillLockEntry, SkillLockFile};

/// Add or update a skill entry in the lock file.
pub fn add_skill_to_lock(
	skill_name: &str,
	mut entry: SkillLockEntry,
) -> std::io::Result<()> {
	let mut lock = read_skill_lock();
	let now = Utc::now().to_rfc3339();

	if let Some(existing) = lock.skills.get(skill_name) {
		// Preserve the original installedAt timestamp
		entry.installed_at = existing.installed_at.clone();
	} else {
		entry.installed_at = now.clone();
	}
	entry.updated_at = now;

	lock.skills.insert(skill_name.to_string(), entry);
	write_skill_lock(&lock)
}

/// Remove a skill from the lock file.
pub fn remove_skill_from_lock(skill_name: &str) -> std::io::Result<bool> {
	let mut lock = read_skill_lock();

	if lock.skills.remove(skill_name).is_some() {
		write_skill_lock(&lock)?;
		Ok(true)
	} else {
		Ok(false)
	}
}

/// Get a skill entry from the lock file.
pub fn get_skill_from_lock(skill_name: &str) -> Option<SkillLockEntry> {
	let lock = read_skill_lock();
	lock.skills.get(skill_name).cloned()
}

/// Get all skills from the lock file.
pub fn get_all_locked_skills() -> BTreeMap<String, SkillLockEntry> {
	let lock = read_skill_lock();
	lock.skills
}

/// Get skills grouped by source for batch update operations.
pub fn get_skills_by_source() -> BTreeMap<String, Vec<String>> {
	let lock = read_skill_lock();
	let mut by_source: BTreeMap<String, Vec<String>> = BTreeMap::new();

	for (skill_name, entry) in lock.skills.iter() {
		by_source
			.entry(entry.source.clone())
			.or_default()
			.push(skill_name.clone());
	}

	by_source
}

/// Check if a prompt has been dismissed.
pub fn is_prompt_dismissed(prompt_key: &str) -> bool {
	let lock = read_skill_lock();
	lock.dismissed
		.as_ref()
		.and_then(|d| match prompt_key {
			"findSkillsPrompt" => d.find_skills_prompt,
			_ => None,
		})
		.unwrap_or(false)
}

/// Mark a prompt as dismissed.
pub fn dismiss_prompt(prompt_key: &str) -> std::io::Result<()> {
	let mut lock = read_skill_lock();
	if lock.dismissed.is_none() {
		lock.dismissed = Some(DismissedPrompts::default());
	}

	if let Some(ref mut dismissed) = lock.dismissed {
		if prompt_key == "findSkillsPrompt" {
			dismissed.find_skills_prompt = Some(true);
		}
	}

	write_skill_lock(&lock)
}

/// Get the last selected agents.
pub fn get_last_selected_agents() -> Option<Vec<String>> {
	let lock = read_skill_lock();
	lock.last_selected_agents
}

/// Save the selected agents to the lock file.
pub fn save_selected_agents(agents: Vec<String>) -> std::io::Result<()> {
	let mut lock = read_skill_lock();
	lock.last_selected_agents = Some(agents);
	write_skill_lock(&lock)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::lock::test_utils::TestLockGuard;

	fn test_entry() -> SkillLockEntry {
		SkillLockEntry {
			source: "owner/repo".to_string(),
			source_type: "github".to_string(),
			source_url: "https://github.com/owner/repo".to_string(),
			skill_path: None,
			skill_folder_hash: "hash".to_string(),
			installed_at: "2024-01-01T00:00:00Z".to_string(),
			updated_at: "2024-01-01T00:00:00Z".to_string(),
			plugin_name: None,
		}
	}

	#[test]
	fn test_add_skill_to_lock_new() {
		let _guard = TestLockGuard::new();
		let entry = test_entry();

		add_skill_to_lock("new-skill", entry).unwrap();

		let lock = read_skill_lock();
		assert!(lock.skills.contains_key("new-skill"));
		let stored = lock.skills.get("new-skill").unwrap();
		assert!(!stored.installed_at.is_empty());
		assert!(!stored.updated_at.is_empty());
	}

	#[test]
	fn test_add_skill_to_lock_preserves_installed_at() {
		let _guard = TestLockGuard::new();

		// Add initial skill
		let entry1 = test_entry();
		add_skill_to_lock("my-skill", entry1).unwrap();

		let lock1 = read_skill_lock();
		let original_installed_at =
			lock1.skills.get("my-skill").unwrap().installed_at.clone();

		// Update the same skill
		let mut entry2 = test_entry();
		entry2.skill_folder_hash = "hash2".to_string();
		add_skill_to_lock("my-skill", entry2).unwrap();

		let lock2 = read_skill_lock();
		let updated = lock2.skills.get("my-skill").unwrap();

		// installedAt should be preserved, updatedAt should change
		assert_eq!(updated.installed_at, original_installed_at);
		assert_ne!(updated.updated_at, original_installed_at);
		assert_eq!(updated.skill_folder_hash, "hash2");
	}

	#[test]
	fn test_remove_skill_from_lock() {
		let _guard = TestLockGuard::new();

		let entry = test_entry();
		add_skill_to_lock("my-skill", entry).unwrap();

		let removed = remove_skill_from_lock("my-skill").unwrap();
		assert!(removed);

		let lock = read_skill_lock();
		assert!(!lock.skills.contains_key("my-skill"));
	}

	#[test]
	fn test_get_skill_from_lock() {
		let _guard = TestLockGuard::new();

		let entry = test_entry();
		add_skill_to_lock("my-skill", entry.clone()).unwrap();

		let retrieved = get_skill_from_lock("my-skill");
		assert!(retrieved.is_some());
		assert_eq!(retrieved.unwrap().source, "owner/repo");

		let not_found = get_skill_from_lock("nonexistent");
		assert!(not_found.is_none());
	}

	#[test]
	fn test_get_all_locked_skills() {
		let _guard = TestLockGuard::new();

		let entry = test_entry();

		add_skill_to_lock("skill-a", entry.clone()).unwrap();
		add_skill_to_lock("skill-b", entry).unwrap();

		let all = get_all_locked_skills();
		assert_eq!(all.len(), 2);
	}

	#[test]
	fn test_get_skills_by_source() {
		let _guard = TestLockGuard::new();

		let mut entry1 = test_entry();
		entry1.source = "owner/repo".to_string();

		let mut entry2 = test_entry();
		entry2.source = "other/repo".to_string();

		add_skill_to_lock("skill-a", entry1.clone()).unwrap();
		add_skill_to_lock("skill-b", entry1).unwrap();
		add_skill_to_lock("skill-c", entry2).unwrap();

		let by_source = get_skills_by_source();
		assert_eq!(by_source.len(), 2);
		assert_eq!(by_source.get("owner/repo").unwrap().len(), 2);
		assert_eq!(by_source.get("other/repo").unwrap().len(), 1);
	}

	#[test]
	fn test_dismiss_prompt() {
		let _guard = TestLockGuard::new();

		assert!(!is_prompt_dismissed("findSkillsPrompt"));

		dismiss_prompt("findSkillsPrompt").unwrap();
		assert!(is_prompt_dismissed("findSkillsPrompt"));
	}

	#[test]
	fn test_save_and_get_last_selected_agents() {
		let _guard = TestLockGuard::new();

		assert!(get_last_selected_agents().is_none());

		save_selected_agents(vec!["claude".to_string(), "cursor".to_string()])
			.unwrap();

		let agents = get_last_selected_agents();
		assert!(agents.is_some());
		let agents = agents.unwrap();
		assert_eq!(agents.len(), 2);
		assert!(agents.contains(&"claude".to_string()));
		assert!(agents.contains(&"cursor".to_string()));
	}
}

pub mod global;
pub mod local;
mod types;
mod io;

#[cfg(test)]
mod test_utils;

// Re-export public API
pub use global::{
	add_skill_to_lock, dismiss_prompt, get_all_locked_skills, get_last_selected_agents,
	get_skill_from_lock, get_skills_by_source, is_prompt_dismissed, remove_skill_from_lock,
	save_selected_agents,
};
pub use io::{get_skill_lock_path, read_skill_lock, write_skill_lock};
pub use types::{DismissedPrompts, SkillLockEntry, SkillLockFile};
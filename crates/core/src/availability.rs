use crate::AgentDescriptor;
use std::path::PathBuf;
use std::process::Command;

/// Information about agent availability
#[derive(Debug, Clone)]
pub struct AvailabilityInfo {
	pub agent_id: &'static str,
	pub has_global_directory: bool,
	pub has_cli: bool,
	pub is_available: bool,
}

/// Check if a CLI binary exists using the `which` command
fn check_cli_exists(cli_name: &str) -> bool {
	Command::new("which")
		.arg(cli_name)
		.output()
		.map(|output| output.status.success())
		.unwrap_or(false)
}

/// Check if a global directory exists
fn check_global_directory_exists(global_path: PathBuf) -> bool {
	global_path.exists()
}

/// Check availability for a single agent
pub fn check_agent_availability(
	descriptor: &AgentDescriptor,
) -> AvailabilityInfo {
	let has_global_directory =
		check_global_directory_exists((descriptor.global_path)());
	let has_cli = check_cli_exists(descriptor.cli_name);

	AvailabilityInfo {
		agent_id: descriptor.id,
		has_global_directory,
		has_cli,
		is_available: has_global_directory || has_cli,
	}
}

/// Check availability for all agents concurrently
pub fn check_all_agents_availability() -> Vec<AvailabilityInfo> {
	use std::thread;

	let descriptors: Vec<&AgentDescriptor> =
		crate::registry::iter_all().collect();

	// Spawn threads for each agent check
	let handles: Vec<_> = descriptors
		.into_iter()
		.map(|descriptor| {
			thread::spawn(move || check_agent_availability(descriptor))
		})
		.collect();

	// Collect results
	handles
		.into_iter()
		.map(|handle: thread::JoinHandle<AvailabilityInfo>| {
			handle.join().expect("Thread panicked")
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_check_cli_exists_for_common_commands() {
		// Test with commands that should exist on most systems
		assert!(check_cli_exists("ls") || check_cli_exists("dir")); // Unix or Windows
		assert!(check_cli_exists("echo"));
	}

	#[test]
	fn test_check_cli_exists_for_nonexistent_command() {
		assert!(!check_cli_exists(
			"this_command_definitely_does_not_exist_12345"
		));
	}

	#[test]
	fn test_check_global_directory_exists() {
		// Test with a path that definitely doesn't exist
		let nonexistent = PathBuf::from("/this/path/definitely/does/not/exist");
		assert!(!check_global_directory_exists(nonexistent));
	}

	#[test]
	fn test_check_agent_availability() {
		use crate::registry;
		let descriptor = registry::get(crate::AgentType::Claude);
		let info = check_agent_availability(descriptor);
		assert_eq!(info.agent_id, "claude");
		assert_eq!(
			info.is_available,
			info.has_global_directory || info.has_cli
		);
	}

	#[test]
	fn test_check_all_agents_availability() {
		let results = check_all_agents_availability();
		assert!(!results.is_empty());

		// Verify each result has proper consistency
		for info in &results {
			assert_eq!(
				info.is_available,
				info.has_global_directory || info.has_cli
			);
		}
	}
}

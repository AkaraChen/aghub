use std::str::FromStr;

use aghub_core::models::AgentType;
use aghub_core::registry;

/// Resolve an agent's global config directory as an absolute, OS-correct path
/// for the desktop "open config folder" action.
///
/// Surface configuration paths are the source of truth, so platform
/// conventions live in one place on the backend rather than being
/// reconstructed in the renderer. Returns `None` for an unknown agent id or
/// when no local surface publishes a configuration path.
#[tauri::command]
pub fn agent_config_dir(agent_id: String) -> Option<String> {
	let agent_type = AgentType::from_str(&agent_id).ok()?;
	let dir = registry::get(agent_type)
		.surfaces
		.iter()
		.flat_map(|surface| surface.configuration_paths)
		.find_map(|resolve| resolve())?;
	Some(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn slash(path: String) -> String {
		path.replace('\\', "/")
	}

	#[test]
	fn resolves_known_agents_to_their_config_dir() {
		let claude =
			agent_config_dir("claude".into()).expect("claude config dir");
		assert!(slash(claude).ends_with("/.claude"));

		let opencode =
			agent_config_dir("opencode".into()).expect("opencode config dir");
		assert!(slash(opencode).ends_with("/.config/opencode"));
	}

	#[test]
	fn accepts_id_aliases() {
		// `from_str` maps "roo" → RooCode, whose data dir is `.roo`.
		let roo = agent_config_dir("roo".into()).expect("roo alias resolves");
		assert!(slash(roo).ends_with("/.roo"));
	}

	#[test]
	fn unknown_agent_id_is_none() {
		// Unknown ids must not silently fall back to Claude's directory.
		assert_eq!(agent_config_dir("does-not-exist".into()), None);
	}
}

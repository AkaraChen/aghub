use crate::{eprintln_verbose, ResourceType};
use aghub_core::manager::ConfigManager;
use anyhow::Result;
use serde_json::json;

pub fn execute(
	manager: &mut ConfigManager,
	resource: ResourceType,
	name: String,
) -> Result<()> {
	match resource {
		ResourceType::Skills => {
			eprintln_verbose!("Disabling skill: {}", name);
			manager.disable_skill(&name)?;
			eprintln_verbose!("Skill disabled successfully");
			println!(
				"{}",
				serde_json::to_string_pretty(
					&json!({"enabled": false, "name": name, "type": "skill" })
				)?
			);
		}
		ResourceType::Mcps => {
			eprintln_verbose!("Disabling MCP server: {}", name);
			manager.disable_mcp(&name)?;
			eprintln_verbose!("MCP server disabled successfully");
			println!(
				"{}",
				serde_json::to_string_pretty(
					&json!({"enabled": false, "name": name, "type": "mcp" })
				)?
			);
		}
	}

	Ok(())
}

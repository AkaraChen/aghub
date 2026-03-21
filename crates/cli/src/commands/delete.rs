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
			eprintln_verbose!("Deleting skill: {}", name);
			manager.remove_skill(&name)?;
			eprintln_verbose!("Skill deleted successfully");
			println!(
				"{}",
				serde_json::to_string_pretty(
					&json!({"deleted": true, "name": name, "type": "skill" })
				)?
			);
		}
		ResourceType::Mcps => {
			eprintln_verbose!("Deleting MCP server: {}", name);
			manager.remove_mcp(&name)?;
			eprintln_verbose!("MCP server deleted successfully");
			println!(
				"{}",
				serde_json::to_string_pretty(
					&json!({"deleted": true, "name": name, "type": "mcp" })
				)?
			);
		}
	}

	Ok(())
}

use aghub_core::{
	adapters::create_adapter, manager::ConfigManager, models::AgentType,
	ConflictDetector,
};
use anyhow::Result;
use std::path::Path;

pub fn execute(
	agent_type: AgentType,
	project_root: Option<&Path>,
) -> Result<()> {
	let mut global_manager =
		ConfigManager::new(create_adapter(agent_type), true, None);
	let global_config = load_or_empty(&mut global_manager)?;

	let project_config = if let Some(root) = project_root {
		let mut project_manager =
			ConfigManager::new(create_adapter(agent_type), false, Some(root));
		Some(load_or_empty(&mut project_manager)?)
	} else {
		None
	};

	let conflicts =
		ConflictDetector::detect(&global_config, project_config.as_ref());
	println!("{}", serde_json::to_string_pretty(&conflicts)?);
	Ok(())
}

fn load_or_empty(
	manager: &mut ConfigManager,
) -> aghub_core::Result<aghub_core::AgentConfig> {
	match manager.load() {
		Ok(config) => Ok(config.clone()),
		Err(_) => {
			manager.init_empty_config();
			Ok(manager
				.config()
				.expect("empty config should be initialized")
				.clone())
		}
	}
}

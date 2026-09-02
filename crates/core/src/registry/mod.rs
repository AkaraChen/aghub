use aghub_agents::{agents, AgentDescriptor, AgentType};

pub static ALL_AGENTS: &[&AgentDescriptor] = &[
	&agents::cursor::DESCRIPTOR,
	&agents::grok::DESCRIPTOR,
	&agents::deepseek_harness::DESCRIPTOR,
	&agents::windsurf::DESCRIPTOR,
	&agents::copilot::DESCRIPTOR,
	&agents::claude::DESCRIPTOR,
	&agents::roocode::DESCRIPTOR,
	&agents::cline::DESCRIPTOR,
	&agents::gemini::DESCRIPTOR,
	&agents::codex::DESCRIPTOR,
	&agents::antigravity::DESCRIPTOR,
	&agents::openclaw::DESCRIPTOR,
	&agents::opencode::DESCRIPTOR,
	&agents::augmentcode::DESCRIPTOR,
	&agents::kilocode::DESCRIPTOR,
	&agents::amp::DESCRIPTOR,
	&agents::zed::DESCRIPTOR,
	&agents::kiro::DESCRIPTOR,
	&agents::warp::DESCRIPTOR,
	&agents::trae::DESCRIPTOR,
	&agents::factory::DESCRIPTOR,
	&agents::kimi::DESCRIPTOR,
	&agents::mistral::DESCRIPTOR,
	&agents::pi::DESCRIPTOR,
	&agents::jetbrains_ai::DESCRIPTOR,
	&agents::adal::DESCRIPTOR,
	&agents::aider::DESCRIPTOR,
	&agents::codebuddy::DESCRIPTOR,
	&agents::codewhale::DESCRIPTOR,
	&agents::command_code::DESCRIPTOR,
	&agents::continue_agent::DESCRIPTOR,
	&agents::qwenpaw::DESCRIPTOR,
	&agents::crush::DESCRIPTOR,
	&agents::dumate::DESCRIPTOR,
	&agents::goose::DESCRIPTOR,
	&agents::hermes::DESCRIPTOR,
	&agents::iflow::DESCRIPTOR,
	&agents::junie::DESCRIPTOR,
	&agents::kode::DESCRIPTOR,
	&agents::mcpjam::DESCRIPTOR,
	&agents::xum::DESCRIPTOR,
	&agents::neovate::DESCRIPTOR,
	&agents::openhands::DESCRIPTOR,
	&agents::pochi::DESCRIPTOR,
	&agents::qoder::DESCRIPTOR,
	&agents::qoderwork::DESCRIPTOR,
	&agents::qwen_code::DESCRIPTOR,
	&agents::workbuddy::DESCRIPTOR,
	&agents::zencoder::DESCRIPTOR,
];

pub fn get(agent_type: AgentType) -> &'static AgentDescriptor {
	let id = agent_type.as_str();
	ALL_AGENTS
		.iter()
		.find(|d| d.id == id)
		.copied()
		.expect("every AgentType must have a registered descriptor")
}

pub fn iter_all() -> impl Iterator<Item = &'static AgentDescriptor> {
	ALL_AGENTS.iter().copied()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn registry_matches_agent_type_catalog() {
		let registered = iter_all()
			.map(|descriptor| descriptor.id)
			.collect::<Vec<_>>();
		let catalog = AgentType::ALL
			.iter()
			.map(AgentType::as_str)
			.collect::<Vec<_>>();

		assert_eq!(registered, catalog);
		for agent_type in AgentType::ALL {
			assert_eq!(get(*agent_type).id, agent_type.as_str());
		}
	}
}

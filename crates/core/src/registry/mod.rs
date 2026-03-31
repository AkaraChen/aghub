use aghub_agents::{agents, AgentDescriptor, AgentType};

pub static ALL_AGENTS: &[&AgentDescriptor] = &[
	&agents::claude::DESCRIPTOR,
	&agents::codex::DESCRIPTOR,
	&agents::openclaw::DESCRIPTOR,
	&agents::opencode::DESCRIPTOR,
	&agents::gemini::DESCRIPTOR,
	&agents::cline::DESCRIPTOR,
	&agents::copilot::DESCRIPTOR,
	&agents::cursor::DESCRIPTOR,
	&agents::antigravity::DESCRIPTOR,
	&agents::kiro::DESCRIPTOR,
	&agents::windsurf::DESCRIPTOR,
	&agents::trae::DESCRIPTOR,
	&agents::zed::DESCRIPTOR,
	&agents::jetbrains_ai::DESCRIPTOR,
	&agents::roocode::DESCRIPTOR,
	&agents::kimi::DESCRIPTOR,
	&agents::mistral::DESCRIPTOR,
	&agents::pi::DESCRIPTOR,
	&agents::augmentcode::DESCRIPTOR,
	&agents::kilocode::DESCRIPTOR,
	&agents::amp::DESCRIPTOR,
	&agents::factory::DESCRIPTOR,
	&agents::warp::DESCRIPTOR,
];

pub fn get(agent_type: AgentType) -> &'static AgentDescriptor {
	let id = agent_type.as_str();
	ALL_AGENTS
		.iter()
		.find(|d| d.id == id)
		.copied()
		.unwrap_or(&agents::claude::DESCRIPTOR)
}

pub fn iter_all() -> impl Iterator<Item = &'static AgentDescriptor> {
	ALL_AGENTS.iter().copied()
}

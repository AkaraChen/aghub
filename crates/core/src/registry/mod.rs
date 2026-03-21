pub mod descriptor;

use crate::agents;
use crate::models::AgentType;
use descriptor::AgentDescriptor;

pub static ALL_AGENTS: &[&AgentDescriptor] = &[
	&agents::claude::DESCRIPTOR,
	&agents::cursor::DESCRIPTOR,
	&agents::windsurf::DESCRIPTOR,
	&agents::copilot::DESCRIPTOR,
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
	&agents::mistral::DESCRIPTOR,
	&agents::pi::DESCRIPTOR,
	&agents::jetbrains_ai::DESCRIPTOR,
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

use aghub_core::{availability, registry};
use rocket::serde::json::Json;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CapabilitiesDto {
	pub mcp_stdio: bool,
	pub mcp_remote: bool,
	pub mcp_enable_disable: bool,
	pub skills: bool,
	pub skills_mutable: bool,
	pub universal_skills: bool,
}

#[derive(Debug, Serialize)]
pub struct AgentInfo {
	pub id: &'static str,
	pub display_name: &'static str,
	pub capabilities: CapabilitiesDto,
}

#[derive(Debug, Serialize)]
pub struct AgentAvailabilityDto {
	pub id: &'static str,
	pub has_global_directory: bool,
	pub has_cli: bool,
	pub is_available: bool,
}

#[get("/agents")]
pub fn list_agents() -> Json<Vec<AgentInfo>> {
	let agents = registry::iter_all()
		.map(|d| AgentInfo {
			id: d.id,
			display_name: d.display_name,
			capabilities: CapabilitiesDto {
				mcp_stdio: d.capabilities.mcp_stdio,
				mcp_remote: d.capabilities.mcp_remote,
				mcp_enable_disable: d.capabilities.mcp_enable_disable,
				skills: d.capabilities.skills,
				skills_mutable: d.capabilities.skills
					&& (d.global_skills_path.is_some()
						|| d.project_skills_path.is_some()
						|| d.capabilities.universal_skills),
				universal_skills: d.capabilities.universal_skills,
			},
		})
		.collect();
	Json(agents)
}

#[get("/agents/availability")]
pub fn check_availability() -> Json<Vec<AgentAvailabilityDto>> {
	let availability_info = availability::check_all_agents_availability();

	let dtos: Vec<AgentAvailabilityDto> = availability_info
		.into_iter()
		.map(|info| AgentAvailabilityDto {
			id: info.agent_id,
			has_global_directory: info.has_global_directory,
			has_cli: info.has_cli,
			is_available: info.is_available,
		})
		.collect();

	Json(dtos)
}

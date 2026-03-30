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
pub struct SkillsPathsDto {
	pub project: Option<String>,
	pub global: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AgentInfo {
	pub id: &'static str,
	pub display_name: &'static str,
	pub capabilities: CapabilitiesDto,
	pub skills_paths: SkillsPathsDto,
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
		.map(|d| {
			let project_skills_path = d
				.project_skills_path
				.as_ref()
				.map(|f| {
					let path = f(std::path::Path::new(""));
					path.to_string_lossy().into_owned()
				})
				.or_else(|| {
					if d.capabilities.universal_skills {
						Some(".agents/skills".to_string())
					} else {
						None
					}
				});

			let global_skills_path = d
				.global_skills_path
				.as_ref()
				.map(|f| {
					let path = f();
					let s = path.to_string_lossy();
					let home = dirs::home_dir()
						.map(|h| h.to_string_lossy().into_owned())
						.unwrap_or_default();
					if s.starts_with(&home) {
						format!("~{}", &s[home.len()..])
					} else {
						s.into_owned()
					}
				})
				.or_else(|| {
					if d.capabilities.universal_skills {
						Some("~/.config/agents/skills".to_string())
					} else {
						None
					}
				});

			AgentInfo {
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
				skills_paths: SkillsPathsDto {
					project: project_skills_path,
					global: global_skills_path,
				},
			}
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_list_agents_includes_pi_without_mcp_capabilities() {
		let agents = list_agents().into_inner();
		let pi = agents
			.into_iter()
			.find(|agent| agent.id == "pi")
			.expect("pi agent should be listed");

		assert!(!pi.capabilities.mcp_stdio);
		assert!(!pi.capabilities.mcp_remote);
		assert!(pi.capabilities.skills);
	}
}

use aghub_core::{availability, registry};
use rocket::serde::json::Json;
use std::path::Path;

use crate::dto::agents::{
	AgentAvailabilityDto, AgentInfo, CapabilitiesDto, McpCapabilitiesDto,
	ScopeSupportDto, SkillCapabilitiesDto, SkillsPathsDto,
};

fn format_path(path: std::path::PathBuf) -> String {
	let s = path.to_string_lossy();
	let Some(home) = dirs::home_dir().map(|h| h.to_string_lossy().into_owned())
	else {
		return s.into_owned();
	};
	if s.starts_with(&home) {
		format!("~{}", &s[home.len()..])
	} else {
		s.into_owned()
	}
}

#[get("/agents")]
pub fn list_agents() -> Json<Vec<AgentInfo>> {
	let agents = registry::iter_all()
		.map(|d| {
			let project_root = Path::new("");
			let project_read = d
				.project_skill_paths
				.map(|paths| {
					(paths.read)(project_root)
						.into_iter()
						.map(format_path)
						.collect()
				})
				.unwrap_or_default();
			let project_write = d
				.project_skill_paths
				.and_then(|paths| (paths.write)(project_root))
				.map(format_path);
			let global_read = d
				.global_skill_read_paths()
				.into_iter()
				.map(format_path)
				.collect();
			let global_write = d
				.skill_write_path(
					None,
					aghub_core::models::ResourceScope::GlobalOnly,
				)
				.map(format_path);

			AgentInfo {
				id: d.id.to_string(),
				display_name: d.display_name.to_string(),
				capabilities: CapabilitiesDto {
					skills: SkillCapabilitiesDto {
						scopes: ScopeSupportDto {
							global: d.capabilities.skills.scopes.global,
							project: d.capabilities.skills.scopes.project,
						},
						universal: d.capabilities.skills.universal,
						mutable_global: d
							.skill_write_path(
								None,
								aghub_core::models::ResourceScope::GlobalOnly,
							)
							.is_some(),
						mutable_project: d.project_skill_paths.is_some(),
					},
					mcp: McpCapabilitiesDto {
						scopes: ScopeSupportDto {
							global: d.capabilities.mcp.scopes.global,
							project: d.capabilities.mcp.scopes.project,
						},
						stdio: d.capabilities.mcp.stdio,
						remote: d.capabilities.mcp.remote,
						enable_disable: d.capabilities.mcp.enable_disable,
					},
				},
				skills_paths: SkillsPathsDto {
					global_read,
					global_write,
					project_read,
					project_write,
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
			id: info.agent_id.to_string(),
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

		assert!(!pi.capabilities.mcp.stdio);
		assert!(!pi.capabilities.mcp.remote);
		assert!(pi.capabilities.skills.scopes.global);
	}
}

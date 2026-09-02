use aghub_core::{
	availability::{self, DetectionProbeKind, DetectionState, ProbeResult},
	registry, AgentSurfaceKind, Capabilities, ResourceScope,
};
use rocket::serde::json::Json;
use std::path::Path;

use crate::auth::ApiAuth;
use crate::dto::agents::{
	AgentAvailabilityDto, AgentInfo, AgentSurfaceAvailabilityDto,
	AgentSurfaceInfoDto, AgentSurfaceKindDto, CapabilitiesDto,
	ConfigurationEvidenceDto, DetectionEvidenceDto, DetectionProbeKindDto,
	DetectionResultDto, DetectionStateDto, McpCapabilitiesDto, ScopeSupportDto,
	SkillCapabilitiesDto, SkillsPathsDto, SubAgentCapabilitiesDto,
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

fn surface_kind(kind: AgentSurfaceKind) -> AgentSurfaceKindDto {
	match kind {
		AgentSurfaceKind::Cli => AgentSurfaceKindDto::Cli,
		AgentSurfaceKind::Ide => AgentSurfaceKindDto::Ide,
		AgentSurfaceKind::Desktop => AgentSurfaceKindDto::Desktop,
		AgentSurfaceKind::Cloud => AgentSurfaceKindDto::Cloud,
		AgentSurfaceKind::RemoteWorkspace => {
			AgentSurfaceKindDto::RemoteWorkspace
		}
	}
}

fn detection_state(state: DetectionState) -> DetectionStateDto {
	match state {
		DetectionState::Detected => DetectionStateDto::Detected,
		DetectionState::NotDetected => DetectionStateDto::NotDetected,
		DetectionState::Unknown => DetectionStateDto::Unknown,
		DetectionState::Error => DetectionStateDto::Error,
	}
}

fn capabilities_dto(
	descriptor: &aghub_core::AgentDescriptor,
	capabilities: Capabilities,
	mutable_project: bool,
) -> CapabilitiesDto {
	CapabilitiesDto {
		skills: SkillCapabilitiesDto {
			scopes: ScopeSupportDto {
				global: capabilities.skills.scopes.global,
				project: capabilities.skills.scopes.project,
			},
			universal: capabilities.skills.universal,
			mutable_global: capabilities.skills.scopes.global
				&& descriptor
					.skill_write_path(None, ResourceScope::GlobalOnly)
					.is_some(),
			mutable_project: capabilities.skills.scopes.project
				&& mutable_project,
		},
		mcp: McpCapabilitiesDto {
			scopes: ScopeSupportDto {
				global: capabilities.mcp.scopes.global,
				project: capabilities.mcp.scopes.project,
			},
			stdio: capabilities.mcp.stdio,
			remote: capabilities.mcp.sse || capabilities.mcp.streamable_http,
			sse: capabilities.mcp.sse,
			streamable_http: capabilities.mcp.streamable_http,
			enable_disable: capabilities.mcp.enable_disable,
		},
		sub_agents: SubAgentCapabilitiesDto {
			scopes: ScopeSupportDto {
				global: capabilities.sub_agents.scopes.global,
				project: capabilities.sub_agents.scopes.project,
			},
		},
	}
}

#[get("/agents")]
pub fn list_agents(_auth: ApiAuth) -> Json<Vec<AgentInfo>> {
	let agents = registry::iter_all()
		.map(|d| {
			let project_root = Path::new("");
			let project_read = if d.capabilities.skills.scopes.project {
				d.project_skill_read_paths(project_root)
					.into_iter()
					.map(format_path)
					.collect()
			} else {
				Vec::new()
			};
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
			let mutable_project = project_write.is_some();
			let surfaces = d
				.surfaces
				.iter()
				.map(|surface| AgentSurfaceInfoDto {
					id: surface.id.to_string(),
					kind: surface_kind(surface.kind),
					capabilities: capabilities_dto(
						d,
						surface.capabilities.unwrap_or(d.capabilities),
						mutable_project,
					),
				})
				.collect();

			AgentInfo {
				id: d.id.to_string(),
				display_name: d.display_name.to_string(),
				surfaces,
				capabilities: capabilities_dto(
					d,
					d.capabilities,
					mutable_project,
				),
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
pub fn check_availability(_auth: ApiAuth) -> Json<Vec<AgentAvailabilityDto>> {
	let availability_info = availability::check_all_agents_availability();

	let dtos: Vec<AgentAvailabilityDto> = availability_info
		.into_iter()
		.map(|info| AgentAvailabilityDto {
			id: info.agent_id.to_string(),
			state: detection_state(info.state),
			configured: info.configured,
			surfaces: info
				.surfaces
				.into_iter()
				.map(|surface| AgentSurfaceAvailabilityDto {
					id: surface.surface_id.to_string(),
					kind: surface_kind(surface.kind),
					state: detection_state(surface.state),
					configured: surface.configured,
					evidence: surface
						.evidence
						.into_iter()
						.map(|entry| DetectionEvidenceDto {
							kind: match entry.kind {
								DetectionProbeKind::Command => {
									DetectionProbeKindDto::Command
								}
								DetectionProbeKind::Path => {
									DetectionProbeKindDto::Path
								}
							},
							target: entry.target,
							result: match entry.result {
								ProbeResult::Detected => {
									DetectionResultDto::Detected
								}
								ProbeResult::Absent => {
									DetectionResultDto::Absent
								}
								ProbeResult::Error => DetectionResultDto::Error,
							},
							detail: entry.detail,
						})
						.collect(),
					configuration: surface
						.configuration
						.into_iter()
						.map(|entry| ConfigurationEvidenceDto {
							path: entry.path,
							exists: entry.exists,
						})
						.collect(),
				})
				.collect(),
		})
		.collect();

	Json(dtos)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_list_agents_includes_pi_without_mcp_capabilities() {
		let agents = list_agents(ApiAuth).into_inner();
		let pi = agents
			.into_iter()
			.find(|agent| agent.id == "pi")
			.expect("pi agent should be listed");

		assert!(!pi.capabilities.mcp.stdio);
		assert!(!pi.capabilities.mcp.remote);
		assert!(pi.capabilities.skills.scopes.global);
	}

	#[test]
	fn list_agents_exposes_universal_project_skill_paths() {
		let agents = list_agents(ApiAuth).into_inner();
		let codex = agents
			.into_iter()
			.find(|agent| agent.id == "codex")
			.expect("Codex agent should be listed");

		assert!(codex
			.skills_paths
			.project_read
			.iter()
			.any(|path| path == ".agents/skills"));
		assert!(codex.skills_paths.project_write.is_none());
	}

	#[test]
	fn list_agents_includes_grok_standard_capabilities() {
		let agents = list_agents(ApiAuth).into_inner();
		let grok = agents
			.into_iter()
			.find(|agent| agent.id == "grok")
			.expect("Grok Build should be listed");

		assert_eq!(grok.display_name, "Grok Build");
		assert!(grok.capabilities.skills.mutable_global);
		assert!(grok.capabilities.skills.mutable_project);
		assert!(grok.capabilities.skills.universal);
		assert!(grok.capabilities.mcp.stdio);
		assert!(grok.capabilities.mcp.remote);
		assert!(grok.capabilities.mcp.enable_disable);
		assert_eq!(
			grok.skills_paths.project_write.as_deref(),
			Some(".grok/skills")
		);
		assert!(grok
			.skills_paths
			.project_read
			.iter()
			.any(|path| path == ".agents/skills"));
	}

	#[test]
	fn list_agents_includes_deepseek_harness_skill_capabilities() {
		let agents = list_agents(ApiAuth).into_inner();
		let deepseek = agents
			.into_iter()
			.find(|agent| agent.id == "deepseek-harness")
			.expect("DeepSeek Harness should be listed");

		assert_eq!(deepseek.display_name, "DeepSeek Harness");
		assert!(deepseek.capabilities.skills.mutable_global);
		assert!(deepseek.capabilities.skills.mutable_project);
		assert!(deepseek.capabilities.skills.universal);
		assert!(!deepseek.capabilities.mcp.stdio);
		assert!(!deepseek.capabilities.mcp.remote);
		assert_eq!(
			deepseek.skills_paths.project_write.as_deref(),
			Some(".dsh/skills")
		);
		assert!(deepseek
			.skills_paths
			.project_read
			.iter()
			.any(|path| path == ".agents/skills"));
	}

	#[test]
	fn availability_keeps_detection_configuration_and_surfaces_separate() {
		let agents = check_availability(ApiAuth).into_inner();
		let cursor = agents
			.into_iter()
			.find(|agent| agent.id == "cursor")
			.expect("Cursor availability should be listed");

		assert!(!cursor.surfaces.is_empty());
		assert!(cursor.surfaces.iter().any(|surface| surface.id == "cli"));
		assert!(cursor.surfaces.iter().any(|surface| surface.id == "ide"));
		assert!(matches!(
			cursor.state,
			DetectionStateDto::Detected
				| DetectionStateDto::NotDetected
				| DetectionStateDto::Unknown
				| DetectionStateDto::Error
		));
	}
}

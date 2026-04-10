use crate::dto::plugin::{
	CCPluginAuthorResponse, CCPluginDetailResponse, CCPluginHookActionResponse,
	CCPluginHookEventResponse, CCPluginHookMatcherResponse,
	CCPluginHooksManifestResponse, CCPluginManifestResponse,
	CCPluginMcpConfigResponse, CCPluginMcpServerResponse, CCPluginSkillInfo,
};
use crate::error::ApiResult;
use log::warn;
use rocket::serde::json::Json;
use std::collections::HashMap;

use super::shared::{load_manager_and_plugin, parse_plugin_id};

#[get("/plugins/<plugin_id>")]
pub async fn get_plugin_detail(
	plugin_id: &str,
) -> ApiResult<CCPluginDetailResponse> {
	let id = parse_plugin_id(plugin_id)?;
	let (_, plugin) = load_manager_and_plugin(&id)?;

	let manifest = plugin.read_manifest().unwrap_or_else(|e| {
		warn!("Failed to read manifest for {}: {}", plugin.id, e);
		None
	});

	let manifest_response =
		manifest.as_ref().map(|m| CCPluginManifestResponse {
			name: m.name.clone(),
			version: m.version.clone(),
			description: m.description.clone(),
			author: (!m.author.is_empty()).then_some(CCPluginAuthorResponse {
				name: m.author.name.clone(),
				email: m.author.email.clone(),
				url: m.author.url.clone(),
			}),
			homepage: m.homepage.clone(),
			repository: m.repository.clone(),
			license: m.license.clone(),
			keywords: m.keywords.clone(),
			logo: m.logo.clone(),
			skills: m.skills.clone().map(|paths| paths.into_vec()),
			agents: m.agents.clone().map(|paths| paths.into_vec()),
			commands: m.commands.clone().map(|paths| paths.into_vec()),
		});

	let hooks = plugin.read_hooks().unwrap_or_else(|e| {
		warn!("Failed to read hooks for {}: {}", plugin.id, e);
		None
	});

	let hooks_response = hooks.map(|h| {
		let events: Vec<CCPluginHookEventResponse> = h
			.hooks
			.into_iter()
			.map(|(event, matchers)| CCPluginHookEventResponse {
				event,
				matchers: matchers
					.into_iter()
					.map(|m| CCPluginHookMatcherResponse {
						matcher: m.matcher,
						hooks: m
							.hooks
							.into_iter()
							.map(|h| CCPluginHookActionResponse {
								action_type: h.action_type,
								command: h.command,
								timeout: h.timeout,
							})
							.collect(),
					})
					.collect(),
			})
			.collect();
		CCPluginHooksManifestResponse { hooks: events }
	});

	let mcp_config = plugin.read_mcp_config().unwrap_or_else(|e| {
		warn!("Failed to read MCP config for {}: {}", plugin.id, e);
		None
	});

	let mcp_response = mcp_config.map(|c| {
		let servers: Vec<CCPluginMcpServerResponse> = c
			.mcp_servers
			.into_iter()
			.map(|(name, s)| CCPluginMcpServerResponse {
				name,
				transport_type: s.transport_type,
				command: s.command,
				args: s.args,
				url: s.url,
				env: s.env,
				headers: s.headers,
				note: s.note,
			})
			.collect();
		CCPluginMcpConfigResponse { servers }
	});

	let base_response = crate::dto::plugin::CCPluginResponse::from(&plugin);
	let mut all_skill_dirs = Vec::new();
	for install_path in plugin.all_install_paths() {
		all_skill_dirs.push(install_path.join("skills"));
		all_skill_dirs.push(install_path.join(".claude/skills"));
	}

	if let Some(manifest) = manifest.as_ref() {
		if let Some(ref skills_paths) = manifest.skills {
			for skills_path in skills_paths.iter() {
				for install_path in plugin.all_install_paths() {
					all_skill_dirs.push(install_path.join(skills_path));
				}
			}
		}
	}

	let mut skill_descriptions: HashMap<String, Option<String>> =
		HashMap::new();
	for skills_dir in &all_skill_dirs {
		if !skills_dir.is_dir() {
			continue;
		}
		if let Ok(entries) = std::fs::read_dir(skills_dir) {
			for entry in entries.flatten() {
				if !entry.path().is_dir() {
					continue;
				}
				if let Ok(name) = entry.file_name().into_string() {
					let description = extract_skill_description(&entry.path());
					skill_descriptions
						.entry(name)
						.and_modify(|existing| {
							if existing.is_none() && description.is_some() {
								*existing = description.clone();
							}
						})
						.or_insert(description);
				}
			}
		}
	}

	let mut provided_skills = skill_descriptions
		.into_iter()
		.map(|(name, description)| CCPluginSkillInfo { name, description })
		.collect::<Vec<_>>();
	provided_skills.sort_by(|a, b| a.name.cmp(&b.name));

	Ok(Json(CCPluginDetailResponse {
		plugin: base_response,
		manifest: manifest_response,
		hooks: hooks_response,
		mcp_config: mcp_response,
		provided_skills,
	}))
}

fn extract_skill_description(skill_dir: &std::path::Path) -> Option<String> {
	skill::parser::parse(skill_dir).ok().map(|s| s.description)
}

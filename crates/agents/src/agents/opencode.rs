use crate::descriptor::*;
use crate::errors::ConfigError;
use crate::models::{Credential, CredentialType};
use crate::sub_agents::{load_scoped_sub_agents, save_scoped_sub_agents};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, serde::Deserialize)]
struct OpenCodeConfig {
	#[serde(default)]
	provider: HashMap<String, OpenCodeProvider>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct OpenCodeProvider {
	npm: Option<String>,
	options: Option<OpenCodeProviderOptions>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct OpenCodeProviderOptions {
	#[serde(rename = "baseURL")]
	base_url: Option<String>,
	endpoint: Option<String>,
	#[serde(rename = "apiKey")]
	api_key: Option<String>,
}

fn mcp_global_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".config/opencode/opencode.json"))
}
fn mcp_project_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".opencode/settings.json"))
}
fn global_data_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".config/opencode"))
}
fn load_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	load_scoped_mcps(
		project_root,
		scope,
		Some(mcp_global_path),
		Some(mcp_project_path),
		mcp_strategy::PARSE_JSON_OPCODE,
	)
}
fn save_mcps(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
	mcps: &[crate::McpServer],
) -> crate::Result<()> {
	save_scoped_mcps(
		project_root,
		scope,
		mcps,
		Some(mcp_global_path),
		Some(mcp_project_path),
		mcp_strategy::SERIALIZE_JSON_OPCODE,
	)
}
fn global_skills_paths() -> Vec<PathBuf> {
	let Some(home) = home_dir() else {
		return Vec::new();
	};
	vec![
		home.join(".config/opencode/skills"),
		home.join(".claude/skills"),
		home.join(".agents/skills"),
	]
}
fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
	vec![
		root.join(".opencode/skills"),
		root.join(".claude/skills"),
		root.join(".agents/skills"),
	]
}

fn global_skill_write_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".config/opencode/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".opencode/skills"))
}

fn sub_agent_global_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".config/opencode/agents"))
}

fn sub_agent_project_dir(root: &Path) -> Option<PathBuf> {
	Some(root.join(".opencode/agents"))
}

fn load_sub_agents(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::SubAgent>> {
	load_scoped_sub_agents(
		project_root,
		scope,
		Some(sub_agent_global_dir),
		Some(sub_agent_project_dir),
	)
}

fn save_sub_agents(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
	agents: &[crate::SubAgent],
) -> crate::Result<()> {
	save_scoped_sub_agents(
		project_root,
		scope,
		agents,
		Some(sub_agent_global_dir),
		Some(sub_agent_project_dir),
	)
}

fn import_credientials(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<Credential>> {
	let providers = load_provider_config(project_root, scope)?;
	let auth_entries = load_auth_keys()?;

	let mut credentials = HashMap::new();

	for (provider_id, provider) in &providers {
		let mut credential = Credential::new(
			provider_id.clone(),
			infer_provider_type(provider_id, Some(provider)),
		);
		credential.base = provider_base(provider);
		credential.key = provider_config_key(provider);
		if credential.base.is_some() || credential.key.is_some() {
			credentials.insert(provider_id.clone(), credential);
		}
	}

	for (provider_id, key) in auth_entries {
		let provider = providers.get(&provider_id);
		let mut credential =
			credentials.remove(&provider_id).unwrap_or_else(|| {
				Credential::new(
					provider_id.clone(),
					infer_provider_type(&provider_id, provider),
				)
			});
		if credential.base.is_none() {
			credential.base = provider.and_then(provider_base);
		}
		credential.key = Some(key);
		credentials.insert(provider_id, credential);
	}

	let mut result: Vec<Credential> = credentials.into_values().collect();
	result.sort_by(|a, b| a.name.cmp(&b.name));
	Ok(result)
}

fn load_provider_config(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<HashMap<String, OpenCodeProvider>> {
	let mut providers = HashMap::new();

	for path in provider_config_paths(project_root, scope)? {
		let content = match fs::read_to_string(&path) {
			Ok(content) => content,
			Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
			Err(e) => return Err(e.into()),
		};
		let config: OpenCodeConfig =
			serde_json::from_str(&content).map_err(|e| {
				ConfigError::InvalidConfig(format!(
					"Failed to parse OpenCode config {}: {e}",
					path.display()
				))
			})?;
		providers.extend(config.provider);
	}

	Ok(providers)
}

fn provider_config_paths(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<PathBuf>> {
	match scope {
		crate::ResourceScope::GlobalOnly => {
			Ok(mcp_global_path().into_iter().collect())
		}
		crate::ResourceScope::ProjectOnly => {
			let Some(root) = project_root else {
				return Ok(Vec::new());
			};
			let mut paths = Vec::new();
			if let Some(path) = mcp_project_path(root) {
				paths.push(path);
			}
			paths.push(root.join("opencode.json"));
			Ok(paths)
		}
		crate::ResourceScope::Both => Err(ConfigError::InvalidConfig(
			"Credential path unavailable for Both scope".to_string(),
		)),
	}
}

fn load_auth_keys() -> crate::Result<HashMap<String, String>> {
	let mut auth = HashMap::new();

	for path in auth_path_candidates() {
		let content = match fs::read_to_string(&path) {
			Ok(content) => content,
			Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
			Err(e) => return Err(e.into()),
		};
		let entries: HashMap<String, serde_json::Value> =
			serde_json::from_str(&content).map_err(|e| {
				ConfigError::InvalidConfig(format!(
					"Failed to parse OpenCode auth {}: {e}",
					path.display()
				))
			})?;
		for (provider_id, entry) in entries {
			if let Some(key) = auth_key_from_entry(&entry) {
				auth.insert(provider_id, key);
			}
		}
	}

	Ok(auth)
}

fn auth_path_candidates() -> Vec<PathBuf> {
	let mut paths = Vec::new();
	if let Some(xdg_data_home) = std::env::var_os("XDG_DATA_HOME") {
		paths.push(PathBuf::from(xdg_data_home).join("opencode/auth.json"));
	}

	let Some(home) = home_dir() else {
		return paths;
	};

	paths.push(home.join(".local/share/opencode/auth.json"));
	paths.push(home.join("Library/Application Support/opencode/auth.json"));
	paths
}

fn auth_key_from_entry(entry: &serde_json::Value) -> Option<String> {
	let key = match entry.get("type").and_then(|value| value.as_str()) {
		Some("api") => entry.get("key").and_then(|value| value.as_str()),
		Some("oauth") => entry.get("access").and_then(|value| value.as_str()),
		Some("wellknown") => {
			entry.get("token").and_then(|value| value.as_str())
		}
		_ => None,
	}?;
	clean_string(Some(key.to_string()))
}

fn infer_provider_type(
	provider_id: &str,
	provider: Option<&OpenCodeProvider>,
) -> CredentialType {
	if provider_id.eq_ignore_ascii_case("anthropic") {
		return CredentialType::Anthropic;
	}

	if let Some(npm) = provider.and_then(|provider| provider.npm.as_deref()) {
		if npm.to_ascii_lowercase().contains("anthropic") {
			return CredentialType::Anthropic;
		}
	}

	CredentialType::Openai
}

fn provider_base(provider: &OpenCodeProvider) -> Option<String> {
	let options = provider.options.as_ref()?;
	clean_string(
		options
			.endpoint
			.clone()
			.or_else(|| options.base_url.clone()),
	)
}

fn provider_config_key(provider: &OpenCodeProvider) -> Option<String> {
	let raw_key = provider
		.options
		.as_ref()
		.and_then(|options| options.api_key.clone())?;
	resolve_value(raw_key)
}

fn resolve_value(raw_value: String) -> Option<String> {
	let trimmed = raw_value.trim();
	if trimmed.is_empty() {
		return None;
	}

	if let Some(env_name) = trimmed
		.strip_prefix("{env:")
		.and_then(|value| value.strip_suffix('}'))
	{
		return std::env::var(env_name)
			.ok()
			.and_then(|value| clean_string(Some(value)));
	}

	if let Some(file_path) = trimmed
		.strip_prefix("{file:")
		.and_then(|value| value.strip_suffix('}'))
	{
		let path = resolve_file_path(file_path);
		return fs::read_to_string(path)
			.ok()
			.and_then(|value| clean_string(Some(value)));
	}

	Some(trimmed.to_string())
}

fn resolve_file_path(file_path: &str) -> PathBuf {
	if let Some(stripped) = file_path.strip_prefix("~/") {
		if let Some(home) = home_dir() {
			return home.join(stripped);
		}
	}
	PathBuf::from(file_path)
}

fn clean_string(value: Option<String>) -> Option<String> {
	value.and_then(|value| {
		let trimmed = value.trim();
		if trimmed.is_empty() {
			None
		} else {
			Some(trimmed.to_string())
		}
	})
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
	id: "opencode",
	display_name: "OpenCode",
	mcp_parse_config: Some(mcp_strategy::PARSE_JSON_OPCODE),
	mcp_serialize_config: Some(mcp_strategy::SERIALIZE_JSON_OPCODE),
	load_mcps,
	save_mcps,
	mcp_global_path: Some(mcp_global_path),
	mcp_project_path: Some(mcp_project_path),
	global_data_dir,
	capabilities: Capabilities {
		skills: SkillCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
			universal: false,
		},
		mcp: McpCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
			stdio: true,
			remote: true,
			enable_disable: true,
		},
		sub_agents: SubAgentCapabilities {
			scopes: ScopeSupport {
				global: true,
				project: true,
			},
		},
	},
	global_skill_paths: Some(GlobalSkillPaths {
		read: global_skills_paths,
		write: global_skill_write_path,
	}),
	project_skill_paths: Some(ProjectSkillPaths {
		read: project_skills_paths,
		write: project_skill_write_path,
	}),
	load_sub_agents,
	save_sub_agents,
	import_credientials,
	cli_name: "opencode",
	validate_args: &["--version"],
	project_markers: &[".opencode"],
	skills_cli_name: Some("opencode"),
};

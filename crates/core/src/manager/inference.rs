use super::ConfigManager;
use crate::{
	errors::{ConfigError, Result},
	models::{AgentType, Credential, CredentialType, ResourceScope},
};
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderTransferStatus {
	Imported,
	Skipped,
}

#[derive(Debug, Clone)]
pub struct ProviderTransferItem {
	pub name: String,
	pub status: ProviderTransferStatus,
	pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderTransferResult {
	pub imported_count: usize,
	pub skipped_count: usize,
	pub items: Vec<ProviderTransferItem>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct CodexConfigFile {
	#[serde(default)]
	model_providers: HashMap<String, CodexProviderConfig>,
	#[serde(flatten)]
	extra: toml::map::Map<String, toml::Value>,
}

#[derive(Debug, Default, Clone, Deserialize, Serialize)]
struct CodexProviderConfig {
	#[serde(skip_serializing_if = "Option::is_none")]
	name: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	base_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	env_key: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	experimental_bearer_token: Option<String>,
}

impl ConfigManager {
	pub fn import_credentials(&self) -> Result<Vec<Credential>> {
		self.ensure_global_scope("import credentials")?;
		self.descriptor().import_credentials(
			self.project_root.as_deref(),
			ResourceScope::GlobalOnly,
		)
	}

	pub fn import_inference_providers_to_codex(
		&mut self,
		credentials: &[Credential],
	) -> Result<ProviderTransferResult> {
		self.ensure_global_scope("import inference providers")?;

		if self.adapter.name() != "codex" {
			return Err(ConfigError::unsupported_operation(
				"import",
				"inference providers",
				self.adapter.name(),
			));
		}

		let path = self
			.adapter
			.mcp_config_path(None, ResourceScope::GlobalOnly)
			.ok_or_else(|| {
				ConfigError::InvalidConfig(
					"Codex config path unavailable".to_string(),
				)
			})?;

		let mut config = load_codex_config(&path)?;
		let mut imported_count = 0usize;
		let mut skipped_count = 0usize;
		let mut items = Vec::new();

		for credential in credentials {
			let Some(base) = clean_string(credential.base.clone()) else {
				skipped_count += 1;
				items.push(ProviderTransferItem {
					name: credential.name.clone(),
					status: ProviderTransferStatus::Skipped,
					reason: Some("Missing base URL".to_string()),
				});
				continue;
			};

			if !self.supports_credential_type(credential.r#type) {
				skipped_count += 1;
				items.push(ProviderTransferItem {
					name: credential.name.clone(),
					status: ProviderTransferStatus::Skipped,
					reason: Some(format!(
						"Unsupported provider type: {}",
						credential_type_name(credential.r#type)
					)),
				});
				continue;
			}

			let desired = CodexProviderConfig {
				name: clean_string(Some(credential.name.clone())),
				base_url: Some(base),
				env_key: None,
				experimental_bearer_token: clean_string(credential.key.clone()),
			};

			let provider_id = self.resolve_provider_id(
				&credential.name,
				desired.base_url.as_deref().unwrap_or_default(),
				&config.model_providers,
			);
			let existing = config.model_providers.get(&provider_id).cloned();

			if existing
				.as_ref()
				.is_some_and(|item| provider_matches(item, &desired))
			{
				skipped_count += 1;
				items.push(ProviderTransferItem {
					name: credential.name.clone(),
					status: ProviderTransferStatus::Skipped,
					reason: Some("Already exists".to_string()),
				});
				continue;
			}

			config.model_providers.insert(provider_id, desired);
			imported_count += 1;
			items.push(ProviderTransferItem {
				name: credential.name.clone(),
				status: ProviderTransferStatus::Imported,
				reason: None,
			});
		}

		if imported_count > 0 {
			save_codex_config(&path, &config)?;
			info!("imported {} inference providers into codex", imported_count);
		}

		Ok(ProviderTransferResult {
			imported_count,
			skipped_count,
			items,
		})
	}

	fn ensure_global_scope(&self, operation: &str) -> Result<()> {
		if self.scope != ResourceScope::GlobalOnly
			|| self.write_scope != ResourceScope::GlobalOnly
			|| self.project_root.is_some()
		{
			return Err(ConfigError::InvalidConfig(format!(
				"{operation} supports global scope only"
			)));
		}
		Ok(())
	}

	fn supports_credential_type(&self, cred_type: CredentialType) -> bool {
		matches!(
			(self.adapter.name(), cred_type),
			("codex", CredentialType::Openai)
		)
	}

	fn descriptor(&self) -> &'static crate::AgentDescriptor {
		crate::registry::get(agent_type_from_id(self.adapter.name()))
	}

	fn resolve_provider_id(
		&self,
		name: &str,
		base_url: &str,
		providers: &HashMap<String, CodexProviderConfig>,
	) -> String {
		let base_id = normalize_provider_id(name);
		let Some(existing) = providers.get(&base_id) else {
			return base_id;
		};
		let existing_base = clean_string(existing.base_url.clone());
		if existing_base.as_deref() == Some(base_url) {
			return base_id;
		}

		let mut index = 2usize;
		loop {
			let candidate = format!("{base_id}-{index}");
			if !providers.contains_key(&candidate) {
				return candidate;
			}
			index += 1;
		}
	}
}

pub fn transfer_opencode_providers_to_codex() -> Result<ProviderTransferResult>
{
	let source = ConfigManager::new(
		crate::create_adapter(AgentType::OpenCode),
		true,
		None,
	);
	let mut target =
		ConfigManager::new(crate::create_adapter(AgentType::Codex), true, None);
	let credentials = source.import_credentials()?;
	target.import_inference_providers_to_codex(&credentials)
}

fn load_codex_config(path: &Path) -> Result<CodexConfigFile> {
	let content = match fs::read_to_string(path) {
		Ok(content) => content,
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
			return Ok(CodexConfigFile::default())
		}
		Err(e) => return Err(e.into()),
	};

	if content.trim().is_empty() {
		return Ok(CodexConfigFile::default());
	}

	toml::from_str(&content).map_err(|e| {
		ConfigError::InvalidConfig(format!(
			"Failed to parse Codex config TOML: {e}"
		))
	})
}

fn save_codex_config(path: &PathBuf, config: &CodexConfigFile) -> Result<()> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}
	let serialized = toml::to_string_pretty(config).map_err(|e| {
		ConfigError::InvalidConfig(format!(
			"Failed to serialize Codex config TOML: {e}"
		))
	})?;
	fs::write(path, serialized)?;
	Ok(())
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

fn provider_matches(
	existing: &CodexProviderConfig,
	desired: &CodexProviderConfig,
) -> bool {
	clean_string(existing.name.clone()) == clean_string(desired.name.clone())
		&& clean_string(existing.base_url.clone())
			== clean_string(desired.base_url.clone())
		&& clean_string(existing.experimental_bearer_token.clone())
			== clean_string(desired.experimental_bearer_token.clone())
}

fn credential_type_name(cred_type: CredentialType) -> &'static str {
	match cred_type {
		CredentialType::Openai => "openai",
		CredentialType::Anthropic => "anthropic",
	}
}

fn normalize_provider_id(name: &str) -> String {
	let mut normalized = String::new();

	for ch in name.chars() {
		if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
			normalized.push(ch.to_ascii_lowercase());
			continue;
		}

		if (ch.is_whitespace() || ch == '/' || ch == '.')
			&& !normalized.ends_with('-')
		{
			normalized.push('-');
		}
	}

	let normalized = normalized.trim_matches('-').to_string();
	if normalized.is_empty() {
		"provider".to_string()
	} else {
		normalized
	}
}

fn agent_type_from_id(id: &str) -> AgentType {
	id.parse().unwrap_or(AgentType::Claude)
}

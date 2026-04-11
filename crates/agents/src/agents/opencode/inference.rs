use crate::descriptor::home_dir;
use crate::errors::ConfigError;
use crate::models::{Credential, CredentialType, ResourceScope};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, serde::Deserialize)]
pub(super) struct OpenCodeConfig {
	#[serde(default)]
	pub(super) provider: HashMap<String, OpenCodeProvider>,
}

#[derive(Debug, Default, serde::Deserialize)]
pub(super) struct OpenCodeProvider {
	pub(super) npm: Option<String>,
	pub(super) options: Option<OpenCodeProviderOptions>,
}

#[derive(Debug, Default, serde::Deserialize)]
pub(super) struct OpenCodeProviderOptions {
	#[serde(rename = "baseURL")]
	pub(super) base_url: Option<String>,
	pub(super) endpoint: Option<String>,
	#[serde(rename = "apiKey")]
	pub(super) api_key: Option<String>,
}

pub(super) fn import_credentials(
	project_root: Option<&Path>,
	scope: ResourceScope,
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
	scope: ResourceScope,
) -> crate::Result<HashMap<String, OpenCodeProvider>> {
	let mut providers = HashMap::new();

	for path in provider_config_paths(project_root, scope)? {
		let content = match fs::read_to_string(&path) {
			Ok(content) => content,
			Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
			Err(e) => return Err(e.into()),
		};
		let config = parse_provider_config(&content, &path)?;
		providers.extend(config.provider);
	}

	Ok(providers)
}

fn parse_provider_config(
	content: &str,
	path: &Path,
) -> crate::Result<OpenCodeConfig> {
	if let Ok(config) = serde_json::from_str(content) {
		return Ok(config);
	}

	json5::from_str(content).map_err(|e| {
		ConfigError::InvalidConfig(format!(
			"Failed to parse OpenCode config {}: {e}",
			path.display()
		))
	})
}

fn provider_config_paths(
	project_root: Option<&Path>,
	scope: ResourceScope,
) -> crate::Result<Vec<PathBuf>> {
	match scope {
		ResourceScope::GlobalOnly => {
			Ok(dedup_paths(global_provider_config_paths()))
		}
		ResourceScope::ProjectOnly => {
			let Some(root) = project_root else {
				return Ok(Vec::new());
			};
			let mut paths =
				vec![root.join("opencode.json"), root.join("opencode.jsonc")];
			if let Some(path) = super::mcp::project_path(root) {
				paths.push(path);
			}
			Ok(dedup_paths(paths))
		}
		ResourceScope::Both => Err(ConfigError::InvalidConfig(
			"Credential path unavailable for Both scope".to_string(),
		)),
	}
}

fn global_provider_config_paths() -> Vec<PathBuf> {
	let mut paths = Vec::new();

	if let Some(home) = home_dir() {
		let config_dir = home.join(".config/opencode");
		paths.push(config_dir.join("opencode.json"));
		paths.push(config_dir.join("opencode.jsonc"));
	}

	if let Some(custom_path) = std::env::var_os("OPENCODE_CONFIG") {
		paths.push(PathBuf::from(custom_path));
	}

	paths.extend(managed_provider_config_paths());
	paths
}

fn managed_provider_config_paths() -> Vec<PathBuf> {
	let mut paths = Vec::new();

	#[cfg(target_os = "macos")]
	{
		let base = PathBuf::from("/Library/Application Support/opencode");
		paths.push(base.join("opencode.json"));
		paths.push(base.join("opencode.jsonc"));
	}

	#[cfg(target_os = "linux")]
	{
		let base = PathBuf::from("/etc/opencode");
		paths.push(base.join("opencode.json"));
		paths.push(base.join("opencode.jsonc"));
	}

	#[cfg(target_os = "windows")]
	{
		if let Some(program_data) = std::env::var_os("ProgramData") {
			let base = PathBuf::from(program_data).join("opencode");
			paths.push(base.join("opencode.json"));
			paths.push(base.join("opencode.jsonc"));
		}
	}

	paths
}

fn dedup_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
	let mut seen = HashSet::new();
	let mut deduped = Vec::new();

	for path in paths {
		if seen.insert(path.clone()) {
			deduped.push(path);
		}
	}

	deduped
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

pub(super) fn provider_base(provider: &OpenCodeProvider) -> Option<String> {
	let options = provider.options.as_ref()?;
	clean_string(
		options
			.endpoint
			.clone()
			.or_else(|| options.base_url.clone()),
	)
}

pub(super) fn provider_config_key(
	provider: &OpenCodeProvider,
) -> Option<String> {
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

#[cfg(test)]
mod tests {
	use super::*;
	use std::ffi::OsString;
	use std::sync::Mutex;
	use tempfile::TempDir;

	static ENV_LOCK: Mutex<()> = Mutex::new(());

	struct EnvVarGuard {
		key: &'static str,
		previous: Option<OsString>,
	}

	impl EnvVarGuard {
		fn set(key: &'static str, value: Option<OsString>) -> Self {
			let previous = std::env::var_os(key);
			match value {
				Some(value) => std::env::set_var(key, value),
				None => std::env::remove_var(key),
			}
			Self { key, previous }
		}
	}

	impl Drop for EnvVarGuard {
		fn drop(&mut self) {
			match self.previous.take() {
				Some(value) => std::env::set_var(self.key, value),
				None => std::env::remove_var(self.key),
			}
		}
	}

	fn write_file(path: &Path, content: &str) {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent).unwrap();
		}
		fs::write(path, content).unwrap();
	}

	#[test]
	fn import_credentials_reads_base_from_jsonc_and_key_from_auth() {
		let _lock = ENV_LOCK.lock().unwrap();
		let temp = TempDir::new().unwrap();
		let home = temp.path().join("home");
		let xdg_data_home = temp.path().join("xdg-data");

		let _home_guard =
			EnvVarGuard::set("HOME", Some(home.clone().into_os_string()));
		let _xdg_data_guard = EnvVarGuard::set(
			"XDG_DATA_HOME",
			Some(xdg_data_home.clone().into_os_string()),
		);
		let _custom_guard = EnvVarGuard::set("OPENCODE_CONFIG", None);

		write_file(
			&home.join(".config/opencode/opencode.jsonc"),
			r#"{
	// base lives in config
	"provider": {
		"custom-provider": {
			"options": {
				"baseURL": "https://api.example.com/v1",
			},
		},
	},
}"#,
		);
		write_file(
			&xdg_data_home.join("opencode/auth.json"),
			r#"{
	"custom-provider": {
		"type": "api",
		"key": "sk-test"
	}
}"#,
		);

		let credentials =
			import_credentials(None, ResourceScope::GlobalOnly).unwrap();

		assert_eq!(credentials.len(), 1);
		assert_eq!(credentials[0].name, "custom-provider");
		assert_eq!(
			credentials[0].base.as_deref(),
			Some("https://api.example.com/v1")
		);
		assert_eq!(credentials[0].key.as_deref(), Some("sk-test"));
	}

	#[test]
	fn import_credentials_prefers_opencode_config_env_file() {
		let _lock = ENV_LOCK.lock().unwrap();
		let temp = TempDir::new().unwrap();
		let home = temp.path().join("home");
		let xdg_data_home = temp.path().join("xdg-data");
		let custom_config = temp.path().join("custom/opencode.json");

		let _home_guard =
			EnvVarGuard::set("HOME", Some(home.clone().into_os_string()));
		let _xdg_data_guard = EnvVarGuard::set(
			"XDG_DATA_HOME",
			Some(xdg_data_home.clone().into_os_string()),
		);
		let _custom_guard = EnvVarGuard::set(
			"OPENCODE_CONFIG",
			Some(custom_config.clone().into_os_string()),
		);

		write_file(
			&home.join(".config/opencode/opencode.json"),
			r#"{
	"provider": {
		"custom-provider": {
			"options": {
				"baseURL": "https://global.example.com/v1"
			}
		}
	}
}"#,
		);
		write_file(
			&custom_config,
			r#"{
	"provider": {
		"custom-provider": {
			"options": {
				"baseURL": "https://custom.example.com/v1"
			}
		}
	}
}"#,
		);
		write_file(
			&xdg_data_home.join("opencode/auth.json"),
			r#"{
	"custom-provider": {
		"type": "api",
		"key": "sk-test"
	}
}"#,
		);

		let credentials =
			import_credentials(None, ResourceScope::GlobalOnly).unwrap();

		assert_eq!(credentials.len(), 1);
		assert_eq!(
			credentials[0].base.as_deref(),
			Some("https://custom.example.com/v1")
		);
	}
}

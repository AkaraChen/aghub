use crate::{
	adapters::AgentAdapter,
	errors::{ConfigError, Result},
	models::AgentConfig,
};
use std::path::{Path, PathBuf};

pub mod mcp;
pub mod skill;

/// Manages configuration loading, saving, and CRUD operations
pub struct ConfigManager {
	pub(crate) adapter: Box<dyn AgentAdapter>,
	pub(crate) config_path: PathBuf,
	pub(crate) config: Option<AgentConfig>,
}

impl ConfigManager {
	pub fn new(
		adapter: Box<dyn AgentAdapter>,
		global: bool,
		project_root: Option<&Path>,
	) -> Self {
		let config_path = if global {
			adapter.global_config_path()
		} else if let Some(root) = project_root {
			adapter.project_config_path(root)
		} else {
			adapter.global_config_path()
		};
		Self {
			adapter,
			config_path,
			config: None,
		}
	}

	pub fn with_path(
		adapter: Box<dyn AgentAdapter>,
		config_path: PathBuf,
	) -> Self {
		Self {
			adapter,
			config_path,
			config: None,
		}
	}

	pub fn config_path(&self) -> &Path {
		&self.config_path
	}

	pub fn agent_name(&self) -> &str {
		self.adapter.name()
	}

	pub fn load(&mut self) -> Result<&AgentConfig> {
		let content = match std::fs::read_to_string(&self.config_path) {
			Ok(content) => content,
			Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
				return Err(ConfigError::not_found(&self.config_path))
			}
			Err(e) => return Err(e.into()),
		};
		let config = self.adapter.parse_config(&content)?;
		self.config = Some(config);
		Ok(self.config.as_ref().unwrap())
	}

	pub fn save(&self, config: &AgentConfig) -> Result<()> {
		if let Some(parent) = self.config_path.parent() {
			std::fs::create_dir_all(parent)?;
		}
		let original_content = std::fs::read_to_string(&self.config_path).ok();
		let content = self
			.adapter
			.serialize_config(config, original_content.as_deref())?;
		std::fs::write(&self.config_path, content)?;
		Ok(())
	}

	pub fn save_current(&self) -> Result<()> {
		match &self.config {
			Some(config) => self.save(config),
			None => Err(ConfigError::InvalidConfig(
				"No configuration loaded".to_string(),
			)),
		}
	}

	pub fn validate(&self) -> Result<()> {
		let output =
			self.adapter.validate_command(&self.config_path).output()?;
		if !output.status.success() {
			let stderr = String::from_utf8_lossy(&output.stderr);
			return Err(ConfigError::ValidationFailed(stderr.to_string()));
		}
		Ok(())
	}

	pub fn config(&self) -> Option<&AgentConfig> {
		self.config.as_ref()
	}

	pub fn init_empty_config(&mut self) {
		if self.config.is_none() {
			self.config = Some(AgentConfig::new());
		}
	}

	pub(crate) fn config_mut(&mut self) -> Result<&mut AgentConfig> {
		self.config.as_mut().ok_or_else(|| {
			ConfigError::InvalidConfig("No configuration loaded".to_string())
		})
	}
}

use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct DiscoveryConfig {
	pub plugins_dir: PathBuf,
	pub marketplaces_subdir: String,
	pub known_marketplaces: Vec<String>,
}

impl Default for DiscoveryConfig {
	fn default() -> Self {
		let plugins_dir = dirs::home_dir()
			.map(|home| home.join(".claude/plugins"))
			.or_else(|| {
				dirs::config_dir()
					.map(|config| config.join("aghub/claude/plugins"))
			})
			.unwrap_or_else(|| {
				std::env::temp_dir().join("aghub/claude/plugins")
			});
		Self {
			plugins_dir,
			marketplaces_subdir: "marketplaces".to_string(),
			known_marketplaces: vec!["claude-plugins-official".to_string()],
		}
	}
}

impl DiscoveryConfig {
	pub fn install_counts_path(&self) -> PathBuf {
		self.plugins_dir.join("install-counts-cache.json")
	}

	pub fn known_marketplaces_path(&self) -> PathBuf {
		self.plugins_dir.join("known_marketplaces.json")
	}

	pub fn marketplace_path(&self, name: &str) -> PathBuf {
		self.plugins_dir.join(&self.marketplaces_subdir).join(name)
	}

	pub fn installed_plugins_path(&self) -> PathBuf {
		self.plugins_dir.join("installed_plugins.json")
	}
}

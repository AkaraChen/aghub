use super::manifest::{parse_mcp_from_manifest, parse_mcp_json, read_manifest};
use super::{types, ClaudePluginInfo};
use anyhow::Result;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

impl ClaudePluginInfo {
	pub fn effective_repository(&self) -> Option<String> {
		self.repository.clone()
	}

	pub fn has_skills(&self) -> bool {
		for path in self.all_install_paths() {
			if path.join("skills").is_dir()
				|| path.join(".claude/skills").is_dir()
			{
				return true;
			}
		}
		false
	}

	pub fn has_hooks(&self) -> bool {
		for path in self.all_install_paths() {
			if path.join("hooks").is_dir() {
				return true;
			}
		}
		false
	}

	pub fn has_mcp(&self) -> bool {
		self.read_mcp_config()
			.ok()
			.flatten()
			.is_some_and(|c| !c.mcp_servers.is_empty())
	}

	pub fn read_manifest(&self) -> Result<Option<types::PluginManifest>> {
		for path in self.all_install_paths() {
			if let Some(manifest) = read_manifest(&path)? {
				return Ok(Some(manifest));
			}
		}
		Ok(None)
	}

	pub fn read_hooks(&self) -> Result<Option<types::HooksManifest>> {
		for path in self.all_install_paths() {
			let hooks_path = path.join("hooks/hooks.json");
			if hooks_path.exists() {
				let content = std::fs::read_to_string(hooks_path)?;
				let manifest = serde_json::from_str(&content)?;
				return Ok(Some(manifest));
			}
		}
		Ok(None)
	}

	pub fn read_mcp_config(&self) -> Result<Option<types::McpConfig>> {
		let paths = self.all_install_paths();

		for path in &paths {
			let mcp_path = path.join(".mcp.json");
			if let Ok(content) = std::fs::read_to_string(&mcp_path) {
				if let Some(config) = parse_mcp_json(&content) {
					return Ok(Some(config));
				}
			}
		}

		for path in &paths {
			if let Ok(Some(config)) = parse_mcp_from_manifest(path) {
				return Ok(Some(config));
			}
		}

		Ok(None)
	}

	pub fn all_install_paths(&self) -> Vec<PathBuf> {
		let mut paths = Vec::new();
		let mut seen = HashSet::new();

		let mut push = |path: PathBuf| {
			if path.is_dir() && seen.insert(path.clone()) {
				paths.push(path);
			}
		};

		push(self.install_path.clone());

		for scope in &self.scopes {
			push(scope.install_path.clone());
		}

		if self
			.install_path
			.to_string_lossy()
			.contains(".claude/plugins/cache")
		{
			if let Some(parent) = self.install_path.parent() {
				if let Ok(entries) = std::fs::read_dir(parent) {
					for entry in entries.flatten() {
						let path = entry.path();
						if path.is_dir() {
							push(path);
						}
					}
				}
			}
		}

		paths
	}

	pub fn owns_path(&self, target: &Path) -> bool {
		for path in self.all_install_paths() {
			if target.starts_with(&path) {
				return true;
			}
		}
		false
	}

	pub fn all_skills_dirs(&self) -> Vec<PathBuf> {
		let install_paths = self.all_install_paths();
		let mut paths = Vec::new();

		for install_path in &install_paths {
			paths.push(install_path.join("skills"));
			paths.push(install_path.join(".claude/skills"));
		}

		if let Ok(Some(manifest)) = self.read_manifest() {
			if let Some(ref skills_paths) = manifest.skills {
				for skills_path in skills_paths.iter() {
					for install_path in &install_paths {
						paths.push(install_path.join(skills_path));
					}
				}
			}
		}

		paths
	}
}

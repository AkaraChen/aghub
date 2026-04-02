//! Claude Code Plugin System Support
//!
//! Handles Claude Code's plugin v2 format:
//! - `~/.claude/plugins/installed_plugins.json` - Plugin manifest
//! - `~/.claude/settings.json` - `enabledPlugins` configuration
//! - `~/.claude/plugins/cache/<source>/<name>/` - Plugin cache directory

pub mod settings;
pub mod types;

use crate::{Plugin, PluginId, PluginSource};
use anyhow::Result;
use std::path::{Path, PathBuf};

/// Claude Code Plugin Manager
pub struct ClaudePluginManager {
    settings: settings::ClaudeSettings,
    installed: Vec<ClaudePluginInfo>,
}

/// Claude-specific plugin metadata
#[derive(Debug, Clone)]
pub struct ClaudePluginInfo {
    pub id: PluginId,
    pub display_name: String,
    pub version: String,
    pub description: Option<String>,
    pub source: PluginSource,
    pub install_path: PathBuf,
    pub enabled: bool,
}

impl ClaudePluginInfo {
    /// Get the skills directory path for this plugin
    pub fn skills_path(&self) -> PathBuf {
        self.install_path.join("skills")
    }

    /// Check if this plugin has skills directory
    pub fn has_skills(&self) -> bool {
        self.skills_path().exists()
    }

    /// Check if this plugin has hooks directory
    pub fn has_hooks(&self) -> bool {
        self.install_path.join("hooks").exists()
    }

    /// Check if this plugin has MCP configuration
    pub fn has_mcp(&self) -> bool {
        self.install_path.join(".mcp.json").exists()
    }

    /// Get the hooks directory path
    pub fn hooks_path(&self) -> PathBuf {
        self.install_path.join("hooks")
    }

    /// Get the MCP config path
    pub fn mcp_path(&self) -> PathBuf {
        self.install_path.join(".mcp.json")
    }

    /// Read plugin manifest (plugin.json)
    pub fn read_manifest(&self) -> Result<Option<types::PluginManifest>> {
        // Try multiple locations for plugin.json
        let possible_paths = [
            self.install_path.join(".claude-plugin/plugin.json"),
            self.install_path.join(".plugin/plugin.json"),
            self.install_path.join("plugin.json"),
        ];

        for path in &possible_paths {
            if path.exists() {
                let content = std::fs::read_to_string(path)?;
                let manifest = serde_json::from_str(&content)?;
                return Ok(Some(manifest));
            }
        }

        Ok(None)
    }

    /// Read hooks configuration (hooks/hooks.json)
    pub fn read_hooks(&self) -> Result<Option<types::HooksManifest>> {
        let hooks_path = self.hooks_path().join("hooks.json");
        if !hooks_path.exists() {
            return Ok(None);
        }

        let content = std::fs::read_to_string(hooks_path)?;
        let manifest = serde_json::from_str(&content)?;
        Ok(Some(manifest))
    }

    /// Read MCP configuration (.mcp.json)
    pub fn read_mcp_config(&self) -> Result<Option<types::McpConfig>> {
        let mcp_path = self.mcp_path();
        if !mcp_path.exists() {
            return Ok(None);
        }

        let content = std::fs::read_to_string(mcp_path)?;
        let config = serde_json::from_str(&content)?;
        Ok(Some(config))
    }
}

impl ClaudePluginManager {
    /// Create a new plugin manager
    pub fn new() -> Result<Self> {
        let settings = settings::ClaudeSettings::load()?;
        let installed = Self::load_installed_plugins(&settings)?;

        Ok(Self {
            settings,
            installed,
        })
    }

    /// Get a specific plugin by ID
    pub fn get_plugin(&self, id: &PluginId) -> Option<&ClaudePluginInfo> {
        self.installed.iter().find(|p| p.id == *id)
    }

    /// Check if Claude plugin system is available
    pub fn is_available() -> bool {
        dirs::home_dir()
            .map(|h| h.join(".claude/plugins/installed_plugins.json").exists())
            .unwrap_or(false)
    }

    /// List all installed plugins
    pub fn list_plugins(&self) -> &[ClaudePluginInfo] {
        &self.installed
    }

    /// Check if a plugin is enabled
    pub fn is_enabled(&self, id: &PluginId) -> bool {
        self.settings.is_enabled(id)
    }

    /// Enable a plugin
    pub fn enable(&mut self, id: &PluginId) -> Result<()> {
        self.settings.set_enabled(id, true);
        self.settings.save()?;

        if let Some(plugin) = self.installed.iter_mut().find(|p| p.id == *id) {
            plugin.enabled = true;
        }
        Ok(())
    }

    /// Disable a plugin
    pub fn disable(&mut self, id: &PluginId) -> Result<()> {
        self.settings.set_enabled(id, false);
        self.settings.save()?;

        if let Some(plugin) = self.installed.iter_mut().find(|p| p.id == *id) {
            plugin.enabled = false;
        }
        Ok(())
    }

    /// Filter skill paths based on plugin enabled status
    pub fn filter_skills(&self, paths: Vec<PathBuf>) -> Vec<PathBuf> {
        paths
            .into_iter()
            .filter(|path| self.should_include_skill(path))
            .collect()
    }

    /// Get plugin skills directory
    pub fn get_plugin_skills_path(&self,
        id: &PluginId
    ) -> Option<PathBuf> {
        self.installed
            .iter()
            .find(|p| p.id == *id)
            .map(|p| p.install_path.join("skills"))
    }

    fn load_installed_plugins(
        settings: &settings::ClaudeSettings
    ) -> Result<Vec<ClaudePluginInfo>> {
        use std::fs;

        let manifest_path = dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?
            .join(".claude/plugins/installed_plugins.json");

        if !manifest_path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&manifest_path)?;
        let manifest: types::InstalledPluginsManifest =
            serde_json::from_str(&content)?;

        let mut plugins = Vec::new();

        for (id_str, installations) in manifest.plugins {
            // Take the first installation (user scope is typically first)
            let Some(info) = installations.first() else {
                continue;
            };

            let id = PluginId::parse(&id_str)?;

            // Extract source from plugin ID (part after @)
            let source_str = id_str.split('@').nth(1).unwrap_or("unknown");
            let source = PluginSource::parse(source_str)?;

            // Extract display name from plugin ID (part before @)
            let display_name = id_str.split('@').next().unwrap_or(&id_str).to_string();

            plugins.push(ClaudePluginInfo {
                id: id.clone(),
                display_name,
                version: info.version.clone(),
                description: None, // Could read from .claude-plugin/plugin.json
                source,
                install_path: PathBuf::from(&info.install_path),
                enabled: settings.is_enabled(&id),
            });
        }

        Ok(plugins)
    }

    fn should_include_skill(&self,
        skill_path: &Path
    ) -> bool {
        // Check if skill is in any plugin's directory
        for plugin in &self.installed {
            if skill_path.starts_with(&plugin.install_path) {
                // It's a plugin skill, only include if enabled
                return plugin.enabled;
            }
        }

        // Not a plugin skill, always include
        true
    }
}

/// Convert to generic Plugin representation
impl From<&ClaudePluginInfo> for Plugin {
    fn from(info: &ClaudePluginInfo) -> Self {
        Self {
            id: info.id.to_string(),
            name: info.display_name.clone(),
            version: info.version.clone(),
            enabled: info.enabled,
            source: info.source.clone(),
        }
    }
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginResponse {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub source: String,
    pub install_path: String,
    pub has_skills: bool,
    pub has_hooks: bool,
    pub has_mcp: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginListResponse {
    pub plugins: Vec<PluginResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnablePluginRequest {
    pub plugin_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisablePluginRequest {
    pub plugin_id: String,
}

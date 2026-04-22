use serde::{Deserialize, Serialize};

/// Plugin source types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginScope {
	User,
	Project,
	Local,
}

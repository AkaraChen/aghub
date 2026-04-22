use crate::PluginId;

/// Domain errors that callers can match on without string inspection.
#[derive(Debug, thiserror::Error)]
pub enum PluginError {
	#[error("Plugin '{id}' is already installed for scope '{scope}'")]
	AlreadyInstalled { id: PluginId, scope: String },

	#[error("Plugin '{id}' is already up to date")]
	AlreadyUpToDate { id: PluginId },
}

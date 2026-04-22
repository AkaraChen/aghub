//! Claude Code plugin types
//!
//! Data structures for parsing installed_plugins.json

mod hooks;
mod installed;
mod manifest;
mod mcp;

pub use self::hooks::{HookAction, HookDefinition, HooksManifest};
pub use self::installed::{
	InstalledPluginInfo, InstalledPluginsManifest, PluginScope,
};
pub use self::manifest::{PluginAuthor, PluginManifest, PluginPathList};
pub use self::mcp::{McpConfig, McpServerConfig};

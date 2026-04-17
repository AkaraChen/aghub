//! Aghub Plugin System
//!
//! Provides support for managing Claude Code Plugin System (v2)

pub mod claude;
pub mod discovery;
pub mod installer;
pub mod lockfile;
pub mod market;

use std::fmt::Display;
use std::path::PathBuf;

#[cfg(test)]
pub(crate) mod test_support {
	use std::sync::OnceLock;
	use tokio::sync::Mutex;

	pub(crate) fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}
}

/// Plugin source location
#[derive(Debug, Clone)]
pub enum PluginSource {
	OfficialRegistry,
	ThirdParty { url: String },
	Local { path: PathBuf },
}

impl Display for PluginSource {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			PluginSource::OfficialRegistry => {
				write!(f, "claude-plugins-official")
			}
			PluginSource::ThirdParty { url } => write!(f, "{}", url),
			PluginSource::Local { path } => write!(f, "{}", path.display()),
		}
	}
}

impl PluginSource {
	pub fn parse(s: &str) -> anyhow::Result<Self> {
		match s {
			"claude-plugins-official" => Ok(Self::OfficialRegistry),
			url if url.starts_with("http") => Ok(Self::ThirdParty {
				url: url.to_string(),
			}),
			path => Ok(Self::Local {
				path: PathBuf::from(path),
			}),
		}
	}
}

/// Plugin ID in format "name@source"
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PluginId {
	pub name: String,
	pub source: String,
}

impl PluginId {
	pub fn parse(s: &str) -> anyhow::Result<Self> {
		let (name, source) = s.rsplit_once('@').ok_or_else(|| {
			anyhow::anyhow!(
				"Invalid plugin ID format. Expected 'name@source', got: {}",
				s
			)
		})?;
		Ok(Self {
			name: name.to_string(),
			source: source.to_string(),
		})
	}
}

impl Display for PluginId {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		write!(f, "{}@{}", self.name, self.source)
	}
}

#[cfg(test)]
mod tests {
	use super::PluginId;

	#[test]
	fn parse_plugin_id_keeps_http_source_segments() {
		let id = PluginId::parse("demo@https://github.com/org/repo")
			.expect("plugin id");

		assert_eq!(id.name, "demo");
		assert_eq!(id.source, "https://github.com/org/repo");
	}

	#[test]
	fn parse_plugin_id_keeps_local_path_segments() {
		let id =
			PluginId::parse("demo@plugins/custom/demo").expect("plugin id");

		assert_eq!(id.name, "demo");
		assert_eq!(id.source, "plugins/custom/demo");
	}

	#[test]
	fn parse_plugin_id_requires_name_and_source() {
		assert!(PluginId::parse("demo").is_err());
	}
}

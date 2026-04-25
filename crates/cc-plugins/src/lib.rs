//! Aghub Plugin System
//!
//! Provides support for managing Claude Code Plugin System (v2)

pub mod claude;
pub mod discovery;
pub mod installer;

use std::fmt::Display;

pub(crate) const MANIFEST_CANDIDATE_PATHS: &[&str] = &[
	".claude-plugin/plugin.json",
	".plugin/plugin.json",
	"plugin.json",
];

pub(crate) fn github_repo_path(reference: &str) -> Option<String> {
	let trimmed = reference.trim_end_matches('/').trim_end_matches(".git");
	let path = if let Some(path) = trimmed.strip_prefix("https://github.com/") {
		path
	} else if let Some(path) = trimmed.strip_prefix("http://github.com/") {
		path
	} else if let Some(path) = trimmed.strip_prefix("git@github.com:") {
		path
	} else if trimmed.contains('/') && !trimmed.contains("://") {
		trimmed
	} else {
		return None;
	};
	let mut segments = path.split('/');
	let owner = segments.next()?;
	let repo = segments.next()?;
	if owner.is_empty() || repo.is_empty() {
		return None;
	}
	Some(format!("{owner}/{repo}"))
}

pub mod errors {
	use crate::PluginId;

	#[derive(Debug, thiserror::Error)]
	pub enum PluginError {
		#[error("Plugin '{id}' is already installed for scope '{scope}'")]
		AlreadyInstalled { id: PluginId, scope: String },

		#[error("Plugin '{id}' is already up to date")]
		AlreadyUpToDate { id: PluginId },
	}
}
use std::path::PathBuf;

#[cfg(test)]
pub(crate) mod test_support {
	use std::path::PathBuf;
	use std::sync::OnceLock;
	use std::time::{SystemTime, UNIX_EPOCH};
	use tokio::sync::Mutex;

	pub(crate) fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}

	pub(crate) fn make_temp_dir(prefix: &str) -> PathBuf {
		let unique = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.unwrap()
			.as_nanos();
		let path = std::env::temp_dir().join(format!("{prefix}-{unique}"));
		std::fs::create_dir_all(&path).unwrap();
		path
	}
}

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

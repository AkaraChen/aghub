use serde::{Deserialize, Serialize};

use super::super::SourceDef;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginAuthor {
	pub name: String,
	pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PluginSource {
	#[serde(rename = "local")]
	LocalRelative { path: String },
	#[serde(rename = "github")]
	GitHub {
		repo: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	#[serde(rename = "git")]
	GitUrl {
		url: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	#[serde(rename = "git-subdir")]
	GitSubdir {
		url: String,
		path: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	#[serde(rename = "npm")]
	Npm {
		package: String,
		version: Option<String>,
		registry: Option<String>,
	},
}

impl PluginSource {
	pub fn from_marketplace_def(def: &SourceDef) -> Self {
		match def {
			SourceDef::Local(path) => {
				Self::LocalRelative { path: path.clone() }
			}
			SourceDef::GitHub { repo, sha, .. } => Self::GitHub {
				repo: repo.clone(),
				git_ref: None,
				sha: sha.clone(),
			},
			SourceDef::Url { url, sha, .. } => Self::GitUrl {
				url: url.clone(),
				git_ref: None,
				sha: sha.clone(),
			},
			SourceDef::GitSubdir { url, path, sha, .. } => Self::GitSubdir {
				url: url.clone(),
				path: path.clone(),
				git_ref: None,
				sha: sha.clone(),
			},
			SourceDef::Npm {
				package,
				version,
				registry,
			} => Self::Npm {
				package: package.clone(),
				version: version.clone(),
				registry: registry.clone(),
			},
		}
	}

	pub fn display_name(&self) -> String {
		match self {
			Self::LocalRelative { path } => format!("local:{}", path),
			Self::GitHub { repo, .. } => format!("github:{}", repo),
			Self::GitUrl { url, .. } => format!("git:{}", url),
			Self::GitSubdir { url, path, .. } => {
				format!("git-subdir:{}/{}", url, path)
			}
			Self::Npm { package, .. } => format!("npm:{}", package),
		}
	}
}

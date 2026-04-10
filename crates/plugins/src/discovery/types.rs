use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::path::PathBuf;

use super::SourceDef;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
	pub id: String,
	pub name: String,
	pub description: String,
	pub version: Option<String>,
	pub author: Option<PluginAuthor>,
	pub category: Option<String>,
	pub source: PluginSource,
	pub marketplace: String,
	pub local_path: Option<PathBuf>,
	pub installed: bool,
	pub enabled: Option<bool>,
	pub install_count: Option<u64>,
	pub homepage: Option<String>,
	pub repository: Option<String>,
	pub keywords: Vec<String>,
	pub git_sha: Option<String>,
	pub has_mcp: bool,
	pub has_skills: bool,
	pub has_hooks: bool,
}

impl PluginInfo {
	pub fn display_version(&self) -> Cow<'_, str> {
		if let Some(version) = self.version.as_deref() {
			return Cow::Borrowed(version);
		}

		if let Some(git_sha) = self.git_sha.as_deref() {
			return Cow::Borrowed(&git_sha[..8.min(git_sha.len())]);
		}

		Cow::Borrowed("latest")
	}

	pub fn display_author(&self) -> Option<String> {
		if let Some(author) = self.author.as_ref().map(|a| a.name.trim()) {
			if !author.is_empty() {
				return Some(author.to_string());
			}
		}

		let source_author = match &self.source {
			PluginSource::GitHub { repo, .. } => extract_github_owner(repo),
			PluginSource::GitUrl { url, .. }
			| PluginSource::GitSubdir { url, .. } => extract_github_owner(url),
			PluginSource::Npm { package, .. } => package
				.strip_prefix('@')
				.and_then(|value| value.split('/').next())
				.filter(|scope| !scope.is_empty())
				.map(str::to_string),
			PluginSource::LocalRelative { .. } => None,
		};

		source_author
			.or_else(|| self.homepage.as_deref().and_then(extract_github_owner))
	}

	pub fn github_url(&self) -> Option<String> {
		match &self.source {
			PluginSource::GitHub { repo, .. } => {
				Some(format!("https://github.com/{}", repo))
			}
			PluginSource::GitUrl { url, .. }
			| PluginSource::GitSubdir { url, .. } => {
				normalize_github_url(url).or_else(|| Some(url.clone()))
			}
			PluginSource::LocalRelative { path } => {
				if let Some(homepage) = self.homepage.as_deref() {
					if homepage.contains("github.com") {
						return Some(
							homepage
								.trim_end_matches('/')
								.trim_end_matches(".git")
								.to_string(),
						);
					}
				}

				if self.marketplace == "claude-plugins-official" {
					Some(format!(
						"https://github.com/anthropics/claude-plugins-official/tree/main/{}",
						path.trim_start_matches("./")
					))
				} else {
					None
				}
			}
			PluginSource::Npm { .. } => None,
		}
	}
}

fn extract_github_owner(reference: &str) -> Option<String> {
	let repo = github_repo_path(reference)?;
	repo.split('/')
		.next()
		.filter(|owner| !owner.is_empty())
		.map(str::to_string)
}

fn normalize_github_url(reference: &str) -> Option<String> {
	let repo = github_repo_path(reference)?;
	Some(format!("https://github.com/{repo}"))
}

fn github_repo_path(reference: &str) -> Option<String> {
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

#[derive(Debug, Deserialize)]
pub struct InstallCountEntry {
	pub plugin: String,
	pub unique_installs: u64,
}

#[derive(Debug, Deserialize)]
pub struct InstallCountsCache {
	pub version: u32,
	pub fetched_at: Option<chrono::DateTime<chrono::Utc>>,
	pub counts: Vec<InstallCountEntry>,
}

#[cfg(test)]
mod tests {
	use super::*;

	fn build_plugin(source: PluginSource) -> PluginInfo {
		PluginInfo {
			id: "plugin@claude-plugins-official".to_string(),
			name: "plugin".to_string(),
			description: String::new(),
			version: None,
			author: None,
			category: None,
			source,
			marketplace: "claude-plugins-official".to_string(),
			local_path: None,
			installed: false,
			enabled: None,
			install_count: None,
			homepage: None,
			repository: None,
			keywords: Vec::new(),
			git_sha: None,
			has_mcp: false,
			has_skills: false,
			has_hooks: false,
		}
	}

	#[test]
	fn display_author_prefers_manifest_author() {
		let mut plugin = build_plugin(PluginSource::GitHub {
			repo: "obra/superpowers".to_string(),
			git_ref: None,
			sha: None,
		});
		plugin.author = Some(PluginAuthor {
			name: "Anthropic".to_string(),
			email: None,
		});

		assert_eq!(plugin.display_author().as_deref(), Some("Anthropic"));
	}

	#[test]
	fn display_author_falls_back_to_github_owner() {
		let plugin = build_plugin(PluginSource::GitUrl {
			url: "https://github.com/obra/superpowers.git".to_string(),
			git_ref: None,
			sha: None,
		});

		assert_eq!(plugin.display_author().as_deref(), Some("obra"));
	}

	#[test]
	fn display_author_and_url_support_repo_shorthand() {
		let plugin = build_plugin(PluginSource::GitSubdir {
			url: "UI5/plugins-claude".to_string(),
			path: "plugins/ui5".to_string(),
			git_ref: None,
			sha: None,
		});

		assert_eq!(plugin.display_author().as_deref(), Some("UI5"));
		assert_eq!(
			plugin.github_url().as_deref(),
			Some("https://github.com/UI5/plugins-claude")
		);
	}

	#[test]
	fn display_author_and_url_fall_back_to_homepage_for_local_sources() {
		let mut plugin = build_plugin(PluginSource::LocalRelative {
			path: "./external_plugins/autofix-bot".to_string(),
		});
		plugin.homepage = Some(
			"https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/autofix-bot"
				.to_string(),
		);

		assert_eq!(plugin.display_author().as_deref(), Some("anthropics"));
		assert_eq!(
			plugin.github_url().as_deref(),
			Some(
				"https://github.com/anthropics/claude-plugins-public/tree/main/external_plugins/autofix-bot"
			)
		);
	}
}

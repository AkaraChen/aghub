//! Strongly-typed views over `claude` CLI JSON output.

use serde::Deserialize;

/// Entry from `claude plugin list --json`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstalledPlugin {
	pub id: String,
	pub version: String,
	pub scope: String,
	pub enabled: bool,
	pub install_path: String,
	pub installed_at: String,
	pub last_updated: String,
}

/// Entry from `claude plugin marketplace list --json`. The `source` discriminant
/// determines which side fields are populated (`repo`, `url`, or `path`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplace {
	pub name: String,
	#[serde(flatten)]
	pub source: CliMarketplaceSource,
	pub install_location: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "source", rename_all = "lowercase")]
pub enum CliMarketplaceSource {
	Github { repo: String },
	Url { url: String },
	Local { path: String },
}

/// `available[]` entry inside `claude plugin list --json --available`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAvailablePlugin {
	pub plugin_id: String,
	pub name: String,
	pub description: String,
	pub marketplace_name: String,
	pub source: CliPluginSource,
	#[serde(default)]
	pub install_count: u64,
}

/// Plugin source as it appears inside marketplace catalog output. Untagged
/// because the CLI emits either a bare relative path or a tagged source object.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum CliPluginSource {
	Path(String),
	Tagged(CliPluginSourceTagged),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "source", rename_all = "kebab-case")]
pub enum CliPluginSourceTagged {
	Github {
		repo: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	Url {
		url: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	GitSubdir {
		url: String,
		path: String,
		#[serde(rename = "ref")]
		git_ref: Option<String>,
		sha: Option<String>,
	},
	Npm {
		package: String,
		version: Option<String>,
		registry: Option<String>,
	},
}

/// Top-level object from `claude plugin list --json --available`.
#[derive(Debug, Clone, Deserialize)]
pub struct CliPluginCatalog {
	pub installed: Vec<CliInstalledPlugin>,
	pub available: Vec<CliAvailablePlugin>,
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn deserialize_installed_plugin_from_cli_output() {
		let json = r#"{
			"id": "commit-commands@claude-plugins-official",
			"version": "76b35e91d1c9",
			"scope": "user",
			"enabled": true,
			"installPath": "/Users/mac/.claude/plugins/cache/claude-plugins-official/commit-commands/76b35e91d1c9",
			"installedAt": "2026-05-12T04:53:07.169Z",
			"lastUpdated": "2026-05-12T04:53:07.169Z"
		}"#;
		let plugin: CliInstalledPlugin = serde_json::from_str(json).unwrap();
		assert_eq!(plugin.id, "commit-commands@claude-plugins-official");
		assert_eq!(plugin.scope, "user");
		assert!(plugin.enabled);
		assert_eq!(plugin.version, "76b35e91d1c9");
	}

	#[test]
	fn deserialize_disabled_plugin_round_trip() {
		let json = r#"{
			"id": "x@y",
			"version": "1.0.0",
			"scope": "project",
			"enabled": false,
			"installPath": "/tmp/x",
			"installedAt": "2026-01-01T00:00:00.000Z",
			"lastUpdated": "2026-01-02T00:00:00.000Z"
		}"#;
		let plugin: CliInstalledPlugin = serde_json::from_str(json).unwrap();
		assert!(!plugin.enabled);
		assert_eq!(plugin.scope, "project");
	}

	#[test]
	fn deserialize_marketplace_github() {
		let json = r#"{
			"name": "claude-plugins-official",
			"source": "github",
			"repo": "anthropics/claude-plugins-official",
			"installLocation": "/Users/mac/.claude/plugins/marketplaces/claude-plugins-official"
		}"#;
		let mp: CliMarketplace = serde_json::from_str(json).unwrap();
		assert_eq!(mp.name, "claude-plugins-official");
		match mp.source {
			CliMarketplaceSource::Github { repo } => {
				assert_eq!(repo, "anthropics/claude-plugins-official");
			}
			_ => panic!("expected github source"),
		}
	}

	#[test]
	fn deserialize_marketplace_url() {
		let json = r#"{
			"name": "x",
			"source": "url",
			"url": "https://example.com/marketplace.json",
			"installLocation": "/tmp/x"
		}"#;
		let mp: CliMarketplace = serde_json::from_str(json).unwrap();
		match mp.source {
			CliMarketplaceSource::Url { url } => {
				assert_eq!(url, "https://example.com/marketplace.json");
			}
			_ => panic!("expected url source"),
		}
	}

	#[test]
	fn deserialize_available_plugin_with_string_source() {
		let json = r#"{
			"pluginId": "commit-commands@claude-plugins-official",
			"name": "commit-commands",
			"description": "Commands for git commit workflows",
			"marketplaceName": "claude-plugins-official",
			"source": "./plugins/commit-commands",
			"installCount": 133619
		}"#;
		let plugin: CliAvailablePlugin = serde_json::from_str(json).unwrap();
		assert_eq!(plugin.install_count, 133619);
		match &plugin.source {
			CliPluginSource::Path(p) => {
				assert_eq!(p, "./plugins/commit-commands")
			}
			_ => panic!("expected path source"),
		}
	}

	#[test]
	fn deserialize_available_plugin_with_git_subdir_source() {
		let json = r#"{
			"pluginId": "42crunch-api-security-testing@claude-plugins-official",
			"name": "42crunch-api-security-testing",
			"description": "Automate API security",
			"marketplaceName": "claude-plugins-official",
			"source": {
				"source": "git-subdir",
				"url": "https://github.com/42Crunch-AI/claude-plugins.git",
				"path": "plugins/api-security-testing",
				"ref": "v1.0.1",
				"sha": "56273e0e20762d76640838300a7431c4260cad32"
			},
			"installCount": 305
		}"#;
		let plugin: CliAvailablePlugin = serde_json::from_str(json).unwrap();
		match &plugin.source {
			CliPluginSource::Tagged(CliPluginSourceTagged::GitSubdir {
				url,
				path,
				git_ref,
				sha,
			}) => {
				assert_eq!(
					url,
					"https://github.com/42Crunch-AI/claude-plugins.git"
				);
				assert_eq!(path, "plugins/api-security-testing");
				assert_eq!(git_ref.as_deref(), Some("v1.0.1"));
				assert!(sha.as_ref().unwrap().starts_with("56273e0e"));
			}
			_ => panic!("expected git-subdir source"),
		}
	}

	#[test]
	fn deserialize_available_plugin_with_url_source() {
		let json = r#"{
			"pluginId": "atlassian@claude-plugins-official",
			"name": "atlassian",
			"description": "Connect to Atlassian products",
			"marketplaceName": "claude-plugins-official",
			"source": {
				"source": "url",
				"url": "https://github.com/atlassian/atlassian-mcp-server.git",
				"sha": "9b52fb18e184edc307ce33f8bf4cdf148dedf1f2"
			},
			"installCount": 67244
		}"#;
		let plugin: CliAvailablePlugin = serde_json::from_str(json).unwrap();
		match &plugin.source {
			CliPluginSource::Tagged(CliPluginSourceTagged::Url {
				url,
				sha,
				..
			}) => {
				assert!(url.starts_with("https://"));
				assert!(sha.is_some());
			}
			_ => panic!("expected url source"),
		}
	}

	#[test]
	fn deserialize_full_catalog() {
		let json = r#"{
			"installed": [],
			"available": [
				{
					"pluginId": "x@m",
					"name": "x",
					"description": "d",
					"marketplaceName": "m",
					"source": "./plugins/x",
					"installCount": 1
				}
			]
		}"#;
		let catalog: CliPluginCatalog = serde_json::from_str(json).unwrap();
		assert!(catalog.installed.is_empty());
		assert_eq!(catalog.available.len(), 1);
		assert_eq!(catalog.available[0].name, "x");
	}
}

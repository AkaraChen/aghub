use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A normalized MCP catalog entry with every supported install method.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCatalogEntry {
	/// Source identifier (reverse-DNS for the official registry, unique).
	pub name: String,
	/// Human-friendly label (`title` when present, else the short name).
	pub display_name: String,
	/// Config-safe name suggested for the installed server.
	pub suggested_name: String,
	/// Namespace prefix of `name` (the part before `/`).
	pub publisher: String,
	pub description: String,
	pub version: String,
	pub repository_url: Option<String>,
	pub install_methods: Vec<McpCatalogInstallMethod>,
}

/// One registry-declared way to install or connect to an MCP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCatalogInstallMethod {
	/// Stable within a catalog entry across server version updates.
	pub id: String,
	/// Human-readable package or remote transport label.
	pub label: String,
	pub transport: McpCatalogTransport,
	/// Values the user can configure before the install plan is resolved.
	pub inputs: Vec<McpCatalogInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpCatalogTransport {
	Stdio {
		command: String,
		args: Vec<McpCatalogArgument>,
		env: Vec<McpCatalogKeyValue>,
	},
	Sse {
		url: McpCatalogValue,
		headers: Vec<McpCatalogKeyValue>,
	},
	StreamableHttp {
		url: McpCatalogValue,
		headers: Vec<McpCatalogKeyValue>,
	},
}

/// One command-line argument. Named arguments are emitted as
/// `<name>=<resolved value>`; positional arguments have no name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCatalogArgument {
	pub name: Option<String>,
	pub value: McpCatalogValue,
}

/// An environment variable or HTTP header in an install plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCatalogKeyValue {
	pub name: String,
	pub value: McpCatalogValue,
}

/// A source value with references to configurable inputs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCatalogValue {
	pub template: String,
	/// Template placeholder to input ID.
	pub variables: BTreeMap<String, String>,
}

/// A value the user can configure before installation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCatalogInput {
	pub id: String,
	pub label: String,
	pub default: Option<String>,
	pub placeholder: Option<String>,
	pub description: Option<String>,
	pub is_required: bool,
	pub is_secret: bool,
	pub format: String,
	pub choices: Vec<String>,
}

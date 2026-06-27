use mcp_catalog::{McpCatalogEntry, McpCatalogEnv};
use serde::Serialize;
use ts_rs::TS;

/// A single MCP server entry from the marketplace, normalized into the one
/// install method the UI offers (a stdio package, otherwise a remote endpoint).
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MarketMcpServer {
	/// Registry identifier (reverse-DNS, unique). Used as the list key.
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
	/// "stdio" | "sse" | "streamable_http".
	pub transport: String,
	/// stdio invocation (present when `transport == "stdio"`).
	pub command: Option<String>,
	pub args: Vec<String>,
	pub env: Vec<MarketMcpEnv>,
	/// remote endpoint (present when `transport != "stdio"`).
	pub url: Option<String>,
	pub headers: Vec<MarketMcpEnv>,
}

/// A declared environment variable or HTTP header the user may need to fill in
/// before the server will run.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MarketMcpEnv {
	pub name: String,
	/// Default or template value from the registry, if any.
	pub value: Option<String>,
	pub description: Option<String>,
	pub is_required: bool,
	pub is_secret: bool,
}

impl From<McpCatalogEntry> for MarketMcpServer {
	fn from(entry: McpCatalogEntry) -> Self {
		Self {
			name: entry.name,
			display_name: entry.display_name,
			suggested_name: entry.suggested_name,
			publisher: entry.publisher,
			description: entry.description,
			version: entry.version,
			repository_url: entry.repository_url,
			transport: entry.transport,
			command: entry.command,
			args: entry.args,
			env: entry.env.into_iter().map(MarketMcpEnv::from).collect(),
			url: entry.url,
			headers: entry
				.headers
				.into_iter()
				.map(MarketMcpEnv::from)
				.collect(),
		}
	}
}

impl From<McpCatalogEnv> for MarketMcpEnv {
	fn from(env: McpCatalogEnv) -> Self {
		Self {
			name: env.name,
			value: env.value,
			description: env.description,
			is_required: env.is_required,
			is_secret: env.is_secret,
		}
	}
}

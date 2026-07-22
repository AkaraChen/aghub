use std::collections::BTreeMap;

use mcp_catalog::{
	McpCatalogArgument, McpCatalogEntry, McpCatalogInput, McpCatalogKeyValue,
	McpCatalogTransport, McpCatalogValue,
};
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MarketMcpServer {
	pub name: String,
	pub display_name: String,
	pub suggested_name: String,
	pub publisher: String,
	pub description: String,
	pub version: String,
	pub repository_url: Option<String>,
	pub transport: MarketMcpTransport,
	pub inputs: Vec<MarketMcpInput>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MarketMcpTransport {
	Stdio {
		command: String,
		args: Vec<MarketMcpArgument>,
		env: Vec<MarketMcpKeyValue>,
	},
	Sse {
		url: MarketMcpValue,
		headers: Vec<MarketMcpKeyValue>,
	},
	StreamableHttp {
		url: MarketMcpValue,
		headers: Vec<MarketMcpKeyValue>,
	},
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MarketMcpArgument {
	pub name: Option<String>,
	pub value: MarketMcpValue,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MarketMcpKeyValue {
	pub name: String,
	pub value: MarketMcpValue,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MarketMcpValue {
	pub template: String,
	pub variables: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MarketMcpInput {
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
			transport: entry.transport.into(),
			inputs: entry.inputs.into_iter().map(Into::into).collect(),
		}
	}
}

impl From<McpCatalogTransport> for MarketMcpTransport {
	fn from(transport: McpCatalogTransport) -> Self {
		match transport {
			McpCatalogTransport::Stdio { command, args, env } => Self::Stdio {
				command,
				args: args.into_iter().map(Into::into).collect(),
				env: env.into_iter().map(Into::into).collect(),
			},
			McpCatalogTransport::Sse { url, headers } => Self::Sse {
				url: url.into(),
				headers: headers.into_iter().map(Into::into).collect(),
			},
			McpCatalogTransport::StreamableHttp { url, headers } => {
				Self::StreamableHttp {
					url: url.into(),
					headers: headers.into_iter().map(Into::into).collect(),
				}
			}
		}
	}
}

impl From<McpCatalogArgument> for MarketMcpArgument {
	fn from(argument: McpCatalogArgument) -> Self {
		Self {
			name: argument.name,
			value: argument.value.into(),
		}
	}
}

impl From<McpCatalogKeyValue> for MarketMcpKeyValue {
	fn from(field: McpCatalogKeyValue) -> Self {
		Self {
			name: field.name,
			value: field.value.into(),
		}
	}
}

impl From<McpCatalogValue> for MarketMcpValue {
	fn from(value: McpCatalogValue) -> Self {
		Self {
			template: value.template,
			variables: value.variables,
		}
	}
}

impl From<McpCatalogInput> for MarketMcpInput {
	fn from(input: McpCatalogInput) -> Self {
		Self {
			id: input.id,
			label: input.label,
			default: input.default,
			placeholder: input.placeholder,
			description: input.description,
			is_required: input.is_required,
			is_secret: input.is_secret,
			format: input.format,
			choices: input.choices,
		}
	}
}

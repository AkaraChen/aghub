use aghub_core::models::{McpServer, McpTransport};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

use crate::dto::common::ConfigSource;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TransportDto {
	Stdio {
		command: String,
		#[serde(default)]
		args: Vec<String>,
		#[serde(skip_serializing_if = "Option::is_none")]
		env: Option<HashMap<String, String>>,
		#[serde(skip_serializing_if = "Option::is_none")]
		timeout: Option<u64>,
	},
	Sse {
		url: String,
		#[serde(skip_serializing_if = "Option::is_none")]
		headers: Option<HashMap<String, String>>,
		#[serde(skip_serializing_if = "Option::is_none")]
		timeout: Option<u64>,
	},
	StreamableHttp {
		url: String,
		#[serde(skip_serializing_if = "Option::is_none")]
		headers: Option<HashMap<String, String>>,
		#[serde(skip_serializing_if = "Option::is_none")]
		timeout: Option<u64>,
	},
}

impl From<&McpTransport> for TransportDto {
	fn from(t: &McpTransport) -> Self {
		match t {
			McpTransport::Stdio {
				command,
				args,
				env,
				timeout,
			} => TransportDto::Stdio {
				command: command.clone(),
				args: args.clone(),
				env: env.clone(),
				timeout: *timeout,
			},
			McpTransport::Sse {
				url,
				headers,
				timeout,
			} => TransportDto::Sse {
				url: url.clone(),
				headers: headers.clone(),
				timeout: *timeout,
			},
			McpTransport::StreamableHttp {
				url,
				headers,
				timeout,
			} => TransportDto::StreamableHttp {
				url: url.clone(),
				headers: headers.clone(),
				timeout: *timeout,
			},
		}
	}
}

impl From<TransportDto> for McpTransport {
	fn from(dto: TransportDto) -> Self {
		match dto {
			TransportDto::Stdio {
				command,
				args,
				env,
				timeout,
			} => McpTransport::Stdio {
				command,
				args,
				env,
				timeout,
			},
			TransportDto::Sse {
				url,
				headers,
				timeout,
			} => McpTransport::Sse {
				url,
				headers,
				timeout,
			},
			TransportDto::StreamableHttp {
				url,
				headers,
				timeout,
			} => McpTransport::StreamableHttp {
				url,
				headers,
				timeout,
			},
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateMcpRequest {
	pub name: String,
	pub transport: TransportDto,
	pub timeout: Option<u64>,
}

impl From<CreateMcpRequest> for McpServer {
	fn from(req: CreateMcpRequest) -> Self {
		McpServer {
			name: req.name,
			enabled: true,
			transport: req.transport.into(),
			timeout: req.timeout,
			config_source: None,
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateMcpRequest {
	pub name: Option<String>,
	pub transport: Option<TransportDto>,
	pub enabled: Option<bool>,
	pub timeout: Option<u64>,
}

impl UpdateMcpRequest {
	pub fn apply_to(self, existing: McpServer) -> McpServer {
		McpServer {
			name: self.name.unwrap_or(existing.name),
			enabled: self.enabled.unwrap_or(existing.enabled),
			transport: self
				.transport
				.map(Into::into)
				.unwrap_or(existing.transport),
			timeout: self.timeout.or(existing.timeout),
			config_source: existing.config_source,
		}
	}
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct McpResponse {
	pub name: String,
	pub enabled: bool,
	pub transport: TransportDto,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub timeout: Option<u64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub source: Option<ConfigSource>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub agent: Option<String>,
}

impl From<McpServer> for McpResponse {
	fn from(s: McpServer) -> Self {
		McpResponse::from(&s)
	}
}

impl From<&McpServer> for McpResponse {
	fn from(s: &McpServer) -> Self {
		McpResponse {
			name: s.name.clone(),
			enabled: s.enabled,
			transport: TransportDto::from(&s.transport),
			timeout: s.timeout,
			source: s.config_source.map(Into::into),
			agent: None,
		}
	}
}

impl From<(McpServer, &str)> for McpResponse {
	fn from((s, agent_id): (McpServer, &str)) -> Self {
		McpResponse {
			agent: Some(agent_id.to_string()),
			..McpResponse::from(s)
		}
	}
}

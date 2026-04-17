pub mod add;
pub mod delete;
pub mod disable;
pub mod enable;
pub mod get;
pub mod update;

use aghub_core::models::McpTransport;
use anyhow::{bail, Result};
use std::collections::HashMap;

/// Parse MCP transport from command line arguments
pub fn parse_mcp_transport(
	command: Option<String>,
	url: Option<String>,
	transport_type: &str,
	headers: Vec<String>,
	env_vars: Vec<String>,
	existing_timeout: Option<u64>,
) -> Result<Option<McpTransport>> {
	if let Some(cmd_str) = command {
		let parts: Vec<String> =
			cmd_str.split_whitespace().map(String::from).collect();
		if parts.is_empty() {
			bail!("Command cannot be empty");
		}
		let command = parts[0].clone();
		let args = parts.into_iter().skip(1).collect();

		let env = parse_env_vars(env_vars);

		Ok(Some(McpTransport::Stdio {
			command,
			args,
			env,
			timeout: existing_timeout,
		}))
	} else if let Some(url_str) = url {
		let headers_map = parse_headers(headers);

		Ok(Some(if transport_type == "sse" {
			McpTransport::Sse {
				url: url_str,
				headers: headers_map,
				timeout: existing_timeout,
			}
		} else {
			McpTransport::StreamableHttp {
				url: url_str,
				headers: headers_map,
				timeout: existing_timeout,
			}
		}))
	} else {
		Ok(None)
	}
}

/// Parse environment variables from KEY=VALUE format
pub fn parse_env_vars(
	env_vars: Vec<String>,
) -> Option<HashMap<String, String>> {
	if env_vars.is_empty() {
		None
	} else {
		let mut env_map = HashMap::new();
		for env_var in env_vars {
			let parts: Vec<_> = env_var.splitn(2, '=').collect();
			if parts.len() == 2 {
				env_map.insert(parts[0].to_string(), parts[1].to_string());
			}
		}
		Some(env_map)
	}
}

/// Parse HTTP headers from KEY:VALUE format
pub fn parse_headers(headers: Vec<String>) -> Option<HashMap<String, String>> {
	if headers.is_empty() {
		None
	} else {
		let mut map = HashMap::new();
		for header in headers {
			let parts: Vec<_> = header.splitn(2, ':').collect();
			if parts.len() == 2 {
				map.insert(
					parts[0].trim().to_string(),
					parts[1].trim().to_string(),
				);
			}
		}
		Some(map)
	}
}

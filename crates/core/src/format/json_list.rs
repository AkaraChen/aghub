use crate::{
	errors::{ConfigError, Result},
	models::{AgentConfig, McpServer, McpTransport, Skill, SubAgent},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Default, Serialize, Deserialize)]
struct ListConfig {
	#[serde(rename = "mcp_servers", default)]
	mcp_servers: Vec<ListMcpServer>,
	#[serde(default)]
	skills: Vec<ListSkill>,
	#[serde(rename = "sub_agents", default)]
	sub_agents: Vec<ListSubAgent>,
	#[serde(flatten)]
	extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ListMcpServer {
	name: String,
	#[serde(flatten)]
	transport: ListMcpTransport,
	#[serde(default)]
	enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ListMcpTransport {
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

#[derive(Debug, Serialize, Deserialize)]
struct ListSkill {
	name: String,
	#[serde(default)]
	enabled: bool,
	description: Option<String>,
	author: Option<String>,
	version: Option<String>,
	#[serde(default)]
	tools: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ListSubAgent {
	name: String,
	#[serde(default)]
	enabled: bool,
	description: Option<String>,
	model: Option<String>,
	instructions: Option<String>,
}

pub fn parse(content: &str) -> Result<AgentConfig> {
	let list_config: ListConfig = serde_json::from_str(content)?;
	let mut config = AgentConfig::new();

	for mcp in list_config.mcp_servers {
		let (transport, timeout) = match mcp.transport {
			ListMcpTransport::Stdio {
				command,
				args,
				env,
				timeout,
			} => (
				McpTransport::Stdio {
					command,
					args,
					env,
					timeout,
				},
				timeout,
			),
			ListMcpTransport::Sse {
				url,
				headers,
				timeout,
			} => (
				McpTransport::Sse {
					url,
					headers,
					timeout,
				},
				timeout,
			),
			ListMcpTransport::StreamableHttp {
				url,
				headers,
				timeout,
			} => (
				McpTransport::StreamableHttp {
					url,
					headers,
					timeout,
				},
				timeout,
			),
		};
		config.mcps.push(McpServer {
			name: mcp.name,
			enabled: mcp.enabled,
			transport,
			timeout,
		});
	}

	for skill in list_config.skills {
		config.skills.push(Skill {
			name: skill.name,
			enabled: skill.enabled,
			description: skill.description,
			author: skill.author,
			version: skill.version,
			tools: skill.tools,
			metadata: None,
		});
	}

	for agent in list_config.sub_agents {
		config.sub_agents.push(SubAgent {
			name: agent.name,
			enabled: agent.enabled,
			description: agent.description,
			model: agent.model,
			instructions: agent.instructions,
		});
	}

	Ok(config)
}

pub fn serialize(
	config: &AgentConfig,
	original_content: Option<&str>,
) -> Result<String> {
	let mut list_config = if let Some(content) = original_content {
		if content.trim().is_empty() {
			ListConfig::default()
		} else {
			serde_json::from_str::<ListConfig>(content).map_err(|e| {
				ConfigError::InvalidConfig(format!(
					"Failed to parse existing config: {}",
					e
				))
			})?
		}
	} else {
		ListConfig::default()
	};

	list_config.mcp_servers.clear();
	list_config.skills.clear();
	list_config.sub_agents.clear();

	for mcp in &config.mcps {
		let transport = match &mcp.transport {
			McpTransport::Stdio {
				command,
				args,
				env,
				timeout,
			} => ListMcpTransport::Stdio {
				command: command.clone(),
				args: args.clone(),
				env: env.clone(),
				timeout: *timeout,
			},
			McpTransport::Sse {
				url,
				headers,
				timeout,
			} => ListMcpTransport::Sse {
				url: url.clone(),
				headers: headers.clone(),
				timeout: *timeout,
			},
			McpTransport::StreamableHttp {
				url,
				headers,
				timeout,
			} => ListMcpTransport::StreamableHttp {
				url: url.clone(),
				headers: headers.clone(),
				timeout: *timeout,
			},
		};
		list_config.mcp_servers.push(ListMcpServer {
			name: mcp.name.clone(),
			transport,
			enabled: mcp.enabled,
		});
	}

	for skill in &config.skills {
		list_config.skills.push(ListSkill {
			name: skill.name.clone(),
			enabled: skill.enabled,
			description: skill.description.clone(),
			author: skill.author.clone(),
			version: skill.version.clone(),
			tools: skill.tools.clone(),
		});
	}

	for agent in &config.sub_agents {
		list_config.sub_agents.push(ListSubAgent {
			name: agent.name.clone(),
			enabled: agent.enabled,
			description: agent.description.clone(),
			model: agent.model.clone(),
			instructions: agent.instructions.clone(),
		});
	}

	serde_json::to_string_pretty(&list_config).map_err(ConfigError::Json)
}

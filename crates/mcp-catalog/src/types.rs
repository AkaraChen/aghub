use serde::{Deserialize, Serialize};

/// A normalized MCP catalog entry, reduced to the single install method the UI
/// offers (a stdio package, otherwise a remote endpoint). Source-neutral so it
/// can represent entries from registries other than the official one.
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
	/// "stdio" | "sse" | "streamable_http".
	pub transport: String,
	/// stdio invocation (present when `transport == "stdio"`).
	pub command: Option<String>,
	pub args: Vec<String>,
	pub env: Vec<McpCatalogEnv>,
	/// remote endpoint (present when `transport != "stdio"`).
	pub url: Option<String>,
	pub headers: Vec<McpCatalogEnv>,
}

/// A declared environment variable or HTTP header the user may need to fill in
/// before the server will run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCatalogEnv {
	pub name: String,
	/// Default or template value from the source, if any.
	pub value: Option<String>,
	pub description: Option<String>,
	pub is_required: bool,
	pub is_secret: bool,
}

// --- Raw official-registry response shapes (subset of the published schema) ---

#[derive(Debug, Deserialize)]
pub(crate) struct ServerListResponse {
	#[serde(default)]
	pub(crate) servers: Vec<ServerEnvelope>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ServerEnvelope {
	pub(crate) server: ServerDetail,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerDetail {
	name: String,
	#[serde(default)]
	description: String,
	#[serde(default)]
	title: Option<String>,
	#[serde(default)]
	version: String,
	#[serde(default)]
	repository: Option<Repository>,
	#[serde(default)]
	packages: Vec<Package>,
	#[serde(default)]
	remotes: Vec<Remote>,
}

#[derive(Debug, Deserialize)]
struct Repository {
	url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Package {
	#[serde(default)]
	registry_type: String,
	#[serde(default)]
	identifier: String,
	#[serde(default)]
	runtime_hint: Option<String>,
	#[serde(default)]
	transport: Option<PackageTransport>,
	#[serde(default)]
	runtime_arguments: Vec<Argument>,
	#[serde(default)]
	package_arguments: Vec<Argument>,
	#[serde(default)]
	environment_variables: Vec<RegistryEnvVar>,
}

#[derive(Debug, Deserialize)]
struct PackageTransport {
	#[serde(rename = "type", default)]
	transport_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Argument {
	#[serde(rename = "type", default)]
	arg_type: String,
	#[serde(default)]
	value: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEnvVar {
	name: String,
	#[serde(default)]
	value: Option<String>,
	#[serde(default)]
	description: Option<String>,
	#[serde(default)]
	is_required: bool,
	#[serde(default)]
	is_secret: bool,
	#[serde(default)]
	default: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Remote {
	#[serde(rename = "type", default)]
	transport_type: String,
	url: String,
	#[serde(default)]
	headers: Vec<RegistryHeader>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryHeader {
	name: String,
	#[serde(default)]
	value: Option<String>,
	#[serde(default)]
	description: Option<String>,
	#[serde(default)]
	is_required: bool,
	#[serde(default)]
	is_secret: bool,
}

// --- Mapping ---

/// Normalize a registry entry, or drop it if it has no install method we can
/// construct.
pub(crate) fn map_detail(detail: ServerDetail) -> Option<McpCatalogEntry> {
	let publisher = detail
		.name
		.split('/')
		.next()
		.unwrap_or_default()
		.to_string();
	let short = detail.name.rsplit('/').next().unwrap_or(&detail.name);
	let display_name = detail
		.title
		.as_deref()
		.map(str::trim)
		.filter(|title| !title.is_empty())
		.map(str::to_string)
		.unwrap_or_else(|| short.to_string());
	let suggested_name = sanitize_name(short);
	let repository_url = detail.repository.map(|repo| repo.url);

	if let Some((command, args, env)) =
		detail.packages.iter().find_map(stdio_install)
	{
		return Some(McpCatalogEntry {
			name: detail.name,
			display_name,
			suggested_name,
			publisher,
			description: detail.description,
			version: detail.version,
			repository_url,
			transport: "stdio".to_string(),
			command: Some(command),
			args,
			env,
			url: None,
			headers: Vec::new(),
		});
	}

	if let Some(remote) = detail.remotes.into_iter().next() {
		let transport = if remote.transport_type == "sse" {
			"sse"
		} else {
			"streamable_http"
		}
		.to_string();
		let headers = remote.headers.into_iter().map(map_header).collect();
		return Some(McpCatalogEntry {
			name: detail.name,
			display_name,
			suggested_name,
			publisher,
			description: detail.description,
			version: detail.version,
			repository_url,
			transport,
			command: None,
			args: Vec::new(),
			env: Vec::new(),
			url: Some(remote.url),
			headers,
		});
	}

	None
}

/// Build a stdio invocation for a package, or `None` if it is not a stdio
/// package or we cannot determine a launch command.
fn stdio_install(
	package: &Package,
) -> Option<(String, Vec<String>, Vec<McpCatalogEnv>)> {
	let is_stdio = package
		.transport
		.as_ref()
		.map(|transport| transport.transport_type == "stdio")
		.unwrap_or(true);
	if !is_stdio {
		return None;
	}

	let command = package_command(package)?;

	let mut args = Vec::new();
	for argument in &package.runtime_arguments {
		if let Some(value) = positional_value(argument) {
			args.push(value);
		}
	}
	if !package.identifier.is_empty() {
		args.push(package.identifier.clone());
	}
	for argument in &package.package_arguments {
		if let Some(value) = positional_value(argument) {
			args.push(value);
		}
	}

	let env = package.environment_variables.iter().map(map_env).collect();

	Some((command, args, env))
}

/// Only literal positional argument values are carried over — named args and
/// placeholder hints are left for the user to complete.
fn positional_value(argument: &Argument) -> Option<String> {
	if argument.arg_type == "positional" || argument.arg_type.is_empty() {
		argument
			.value
			.as_deref()
			.map(str::trim)
			.filter(|value| !value.is_empty())
			.map(str::to_string)
	} else {
		None
	}
}

fn package_command(package: &Package) -> Option<String> {
	if let Some(hint) = package.runtime_hint.as_deref() {
		let hint = hint.trim();
		if !hint.is_empty() {
			return Some(hint.to_string());
		}
	}
	match package.registry_type.as_str() {
		"npm" => Some("npx".to_string()),
		"pypi" => Some("uvx".to_string()),
		"oci" => Some("docker".to_string()),
		_ => None,
	}
}

fn map_env(env: &RegistryEnvVar) -> McpCatalogEnv {
	McpCatalogEnv {
		name: env.name.clone(),
		value: env
			.value
			.as_deref()
			.or(env.default.as_deref())
			.filter(|value| !value.is_empty())
			.map(str::to_string),
		description: env
			.description
			.as_deref()
			.filter(|value| !value.is_empty())
			.map(str::to_string),
		is_required: env.is_required,
		is_secret: env.is_secret,
	}
}

fn map_header(header: RegistryHeader) -> McpCatalogEnv {
	McpCatalogEnv {
		name: header.name,
		value: header.value.filter(|value| !value.is_empty()),
		description: header.description.filter(|value| !value.is_empty()),
		is_required: header.is_required,
		is_secret: header.is_secret,
	}
}

/// Reduce a source short name to a config-safe identifier.
fn sanitize_name(raw: &str) -> String {
	let cleaned: String = raw
		.chars()
		.map(|c| {
			if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
				c
			} else {
				'-'
			}
		})
		.collect();
	let trimmed = cleaned.trim_matches('-').to_lowercase();
	if trimmed.is_empty() {
		"mcp-server".to_string()
	} else {
		trimmed
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn parse(json: &str) -> Vec<McpCatalogEntry> {
		let response: ServerListResponse =
			serde_json::from_str(json).expect("valid registry json");
		response
			.servers
			.into_iter()
			.filter_map(|envelope| map_detail(envelope.server))
			.collect()
	}

	#[test]
	fn maps_stdio_npm_package_with_env() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"com.pulsemcp/remote-filesystem",
				"description":"Remote FS",
				"version":"0.1.3",
				"repository":{"url":"https://github.com/pulsemcp/mcp-servers","source":"github"},
				"packages":[{
					"registryType":"npm",
					"identifier":"remote-filesystem-mcp-server",
					"version":"0.1.3",
					"runtimeHint":"npx",
					"transport":{"type":"stdio"},
					"runtimeArguments":[{"value":"-y","type":"positional"}],
					"environmentVariables":[
						{"name":"GCS_BUCKET","isRequired":true,"description":"bucket"},
						{"name":"GCS_PRIVATE_KEY","isSecret":true},
						{"name":"API_KEY","value":"{your_api_key}","isSecret":true},
						{"name":"REGION","default":"us-east-1"}
					]
				}]
			},"_meta":{}}]}"#,
		);

		assert_eq!(servers.len(), 1);
		let server = &servers[0];
		assert_eq!(server.name, "com.pulsemcp/remote-filesystem");
		assert_eq!(server.publisher, "com.pulsemcp");
		assert_eq!(server.display_name, "remote-filesystem");
		assert_eq!(server.suggested_name, "remote-filesystem");
		assert_eq!(server.transport, "stdio");
		assert_eq!(server.command.as_deref(), Some("npx"));
		assert_eq!(
			server.args,
			vec!["-y".to_string(), "remote-filesystem-mcp-server".to_string()]
		);
		assert_eq!(server.env.len(), 4);
		assert!(server.env[0].is_required);
		assert!(server.env[1].is_secret);
		// `value` template is carried through (registry KeyValueInput.value)
		assert_eq!(server.env[2].value.as_deref(), Some("{your_api_key}"));
		// `default` is used as a fallback when no `value` is present
		assert_eq!(server.env[3].value.as_deref(), Some("us-east-1"));
		assert_eq!(
			server.repository_url.as_deref(),
			Some("https://github.com/pulsemcp/mcp-servers")
		);
	}

	#[test]
	fn falls_back_to_remote_when_no_stdio_package() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"ai.smithery/example",
				"title":"Example Server",
				"description":"Remote only",
				"version":"1.0.0",
				"remotes":[{
					"type":"streamable-http",
					"url":"https://server.smithery.ai/example/mcp",
					"headers":[{"name":"Authorization","value":"Bearer {smithery_api_key}","isRequired":true,"isSecret":true}]
				}]
			},"_meta":{}}]}"#,
		);

		assert_eq!(servers.len(), 1);
		let server = &servers[0];
		assert_eq!(server.display_name, "Example Server");
		assert_eq!(server.transport, "streamable_http");
		assert_eq!(
			server.url.as_deref(),
			Some("https://server.smithery.ai/example/mcp")
		);
		assert!(server.command.is_none());
		assert_eq!(server.headers.len(), 1);
		assert_eq!(server.headers[0].name, "Authorization");
		assert!(server.headers[0].is_secret);
	}

	#[test]
	fn derives_command_from_registry_type_without_hint() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/py-server",
				"description":"py",
				"version":"2.0.0",
				"packages":[{"registryType":"pypi","identifier":"acme-mcp","transport":{"type":"stdio"}}]
			},"_meta":{}}]}"#,
		);

		assert_eq!(servers.len(), 1);
		assert_eq!(servers[0].command.as_deref(), Some("uvx"));
		assert_eq!(servers[0].args, vec!["acme-mcp".to_string()]);
	}

	#[test]
	fn drops_entries_without_installable_method() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/unknown",
				"description":"no usable package",
				"version":"1.0.0",
				"packages":[{"registryType":"mystery","identifier":"x","transport":{"type":"stdio"}}]
			},"_meta":{}}]}"#,
		);

		assert!(servers.is_empty());
	}

	#[test]
	fn sanitizes_suggested_name() {
		assert_eq!(
			sanitize_name("Hint-Services-obsidian"),
			"hint-services-obsidian"
		);
		assert_eq!(sanitize_name("weird name@1.0"), "weird-name-1-0");
		assert_eq!(sanitize_name("///"), "mcp-server");
	}
}

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

// npx must not pause for an install prompt; OCI stdio servers need an
// attached stdin and a disposable container for MCP's process lifetime.
const NPM_RUNTIME_ARGS: &[&str] = &["-y"];
const OCI_RUNTIME_ARGS: &[&str] = &["run", "-i", "--rm"];

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

// --- Raw official-registry response shapes (subset of the published schema) ---

#[derive(Debug, Deserialize)]
pub(crate) struct ServerListResponse {
	/// Parsed as raw values so one malformed entry never fails the whole list.
	#[serde(default)]
	pub(crate) servers: Vec<serde_json::Value>,
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
	#[serde(default)]
	url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Package {
	#[serde(default)]
	registry_type: String,
	#[serde(default)]
	identifier: String,
	#[serde(default)]
	version: String,
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
	name: Option<String>,
	#[serde(default)]
	value_hint: Option<String>,
	#[serde(flatten)]
	input: RegistryInput,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryInput {
	#[serde(default)]
	value: Option<String>,
	#[serde(default)]
	default: Option<String>,
	#[serde(default)]
	placeholder: Option<String>,
	#[serde(default)]
	description: Option<String>,
	#[serde(default)]
	is_required: bool,
	#[serde(default)]
	is_secret: bool,
	#[serde(default = "default_input_format")]
	format: String,
	#[serde(default)]
	choices: Vec<String>,
	#[serde(default)]
	variables: BTreeMap<String, RegistryInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEnvVar {
	name: String,
	#[serde(flatten)]
	input: RegistryInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Remote {
	#[serde(rename = "type", default)]
	transport_type: String,
	url: String,
	#[serde(default)]
	headers: Vec<RegistryHeader>,
	#[serde(default)]
	variables: BTreeMap<String, RegistryInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryHeader {
	name: String,
	#[serde(flatten)]
	input: RegistryInput,
}

fn default_input_format() -> String {
	"string".to_string()
}

// --- Mapping ---

/// Parse a single raw registry entry, isolating failures so one malformed or
/// partial entry is skipped rather than failing the whole response.
pub(crate) fn entry_from_value(
	value: serde_json::Value,
) -> Option<McpCatalogEntry> {
	let envelope: ServerEnvelope = serde_json::from_value(value).ok()?;
	map_detail(envelope.server)
}

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
	let repository_url = detail
		.repository
		.and_then(|repo| repo.url)
		.filter(|url| is_http_url(url));
	let mut install_methods: Vec<_> =
		detail.packages.iter().filter_map(stdio_install).collect();
	install_methods
		.extend(detail.remotes.into_iter().filter_map(remote_install));
	let mut seen_ids = std::collections::HashSet::new();
	install_methods.retain(|method| seen_ids.insert(method.id.clone()));
	if install_methods.is_empty() {
		return None;
	}

	Some(McpCatalogEntry {
		name: detail.name,
		display_name,
		suggested_name,
		publisher,
		description: detail.description,
		version: detail.version,
		repository_url,
		install_methods,
	})
}

/// Build a stdio invocation for a package, or `None` if it is not a stdio
/// package or we cannot determine a launch command.
fn stdio_install(package: &Package) -> Option<McpCatalogInstallMethod> {
	let is_stdio = package
		.transport
		.as_ref()
		.map(|transport| transport.transport_type == "stdio")
		.unwrap_or(true);
	if !is_stdio {
		return None;
	}
	if package.identifier.trim().is_empty() {
		return None;
	}

	let mut inputs = Vec::new();
	let command = package_command(package)?;

	let default_args = default_runtime_args(package.registry_type.as_str());
	let mut args = Vec::new();
	for value in default_args {
		args.push(McpCatalogArgument {
			name: None,
			value: literal_value((*value).to_string()),
		});
	}
	for (index, argument) in package.runtime_arguments.iter().enumerate() {
		if let Some(argument) = map_argument(
			argument,
			&format!("runtime.{index}"),
			index,
			&mut inputs,
		) {
			if argument.name.is_none()
				&& argument.value.variables.is_empty()
				&& default_args.contains(&argument.value.template.as_str())
			{
				continue;
			}
			args.push(argument);
		}
	}
	args.push(McpCatalogArgument {
		name: None,
		value: literal_value(package_reference(package)),
	});
	let package_args: Vec<_> = package
		.package_arguments
		.iter()
		.enumerate()
		.filter_map(|(index, argument)| {
			map_argument(
				argument,
				&format!("package.{index}"),
				index,
				&mut inputs,
			)
		})
		.collect();
	if package.registry_type == "nuget" && !package_args.is_empty() {
		args.push(McpCatalogArgument {
			name: None,
			value: literal_value("--".to_string()),
		});
	}
	args.extend(package_args);

	let env = package
		.environment_variables
		.iter()
		.enumerate()
		.map(|(index, env)| {
			map_key_value(&env.name, &env.input, "env", index, &mut inputs)
		})
		.collect();

	Some(McpCatalogInstallMethod {
		id: format!(
			"{}:{}",
			package.registry_type.to_ascii_lowercase(),
			package.identifier
		),
		label: package_method_label(package),
		transport: McpCatalogTransport::Stdio { command, args, env },
		inputs,
	})
}

fn package_method_label(package: &Package) -> String {
	let registry = match package.registry_type.as_str() {
		"npm" => "npm",
		"pypi" => "PyPI",
		"nuget" => "NuGet",
		"oci" => "OCI",
		other => other,
	};
	format!("{registry} · {}", package.identifier)
}

fn default_runtime_args(registry_type: &str) -> &'static [&'static str] {
	match registry_type {
		"npm" => NPM_RUNTIME_ARGS,
		"oci" => OCI_RUNTIME_ARGS,
		_ => &[],
	}
}

fn package_reference(package: &Package) -> String {
	let version = package.version.trim();
	if version.is_empty()
		|| !matches!(package.registry_type.as_str(), "npm" | "pypi" | "nuget")
	{
		package.identifier.clone()
	} else {
		format!("{}@{version}", package.identifier)
	}
}

fn map_argument(
	argument: &Argument,
	id: &str,
	index: usize,
	inputs: &mut Vec<McpCatalogInput>,
) -> Option<McpCatalogArgument> {
	let (name, label) = match argument.arg_type.as_str() {
		"named" => {
			let name = argument
				.name
				.as_deref()
				.map(str::trim)
				.filter(|name| !name.is_empty())?;
			(Some(name.to_string()), name.to_string())
		}
		"positional" | "" => {
			let label = argument
				.value_hint
				.as_deref()
				.map(str::trim)
				.filter(|hint| !hint.is_empty())
				.map(str::to_string)
				.unwrap_or_else(|| format!("Argument {}", index + 1));
			(None, label)
		}
		_ => return None,
	};
	let value = normalize_value(&argument.input, id, &label, inputs);
	if value.template.is_empty() && value.variables.is_empty() {
		return None;
	}
	Some(McpCatalogArgument { name, value })
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
		"nuget" => Some("dnx".to_string()),
		"oci" => Some("docker".to_string()),
		_ => None,
	}
}

fn remote_install(remote: Remote) -> Option<McpCatalogInstallMethod> {
	if remote.url.trim().is_empty() {
		return None;
	}
	let id = format!("{}:{}", remote.transport_type, remote.url);
	let transport_label = match remote.transport_type.as_str() {
		"sse" => "SSE",
		"streamable-http" => "Streamable HTTP",
		_ => return None,
	};
	let label = format!("{transport_label} · {}", remote.url);
	let mut inputs = Vec::new();
	let url_input = RegistryInput {
		value: Some(remote.url),
		variables: remote.variables,
		..RegistryInput::default()
	};
	let url = normalize_value(&url_input, "remote.url", "URL", &mut inputs);
	let headers = remote
		.headers
		.iter()
		.enumerate()
		.map(|(index, header)| {
			map_key_value(
				&header.name,
				&header.input,
				"header",
				index,
				&mut inputs,
			)
		})
		.collect();
	let transport = match remote.transport_type.as_str() {
		"sse" => McpCatalogTransport::Sse { url, headers },
		"streamable-http" => {
			McpCatalogTransport::StreamableHttp { url, headers }
		}
		_ => unreachable!("remote transport checked above"),
	};
	Some(McpCatalogInstallMethod {
		id,
		label,
		transport,
		inputs,
	})
}

fn map_key_value(
	name: &str,
	input: &RegistryInput,
	kind: &str,
	index: usize,
	inputs: &mut Vec<McpCatalogInput>,
) -> McpCatalogKeyValue {
	let id = format!("{kind}.{index}.{}", sanitize_input_id(name));
	McpCatalogKeyValue {
		name: name.to_string(),
		value: normalize_value(input, &id, name, inputs),
	}
}

fn normalize_value(
	input: &RegistryInput,
	id: &str,
	label: &str,
	inputs: &mut Vec<McpCatalogInput>,
) -> McpCatalogValue {
	let mut template =
		input.value.clone().unwrap_or_else(|| "{value}".to_string());
	let mut variables = BTreeMap::new();
	if input.value.is_none() {
		push_input(inputs, id, label, input);
		variables.insert("value".to_string(), id.to_string());
	}

	for (name, variable) in &input.variables {
		let placeholder = format!("{{{name}}}");
		if !template.contains(&placeholder) {
			continue;
		}
		if let Some(value) = variable.value.as_deref() {
			template = template.replace(&placeholder, value);
		} else {
			let variable_id = format!("{id}.{}", sanitize_input_id(name));
			push_input(inputs, &variable_id, name, variable);
			variables.insert(name.clone(), variable_id);
		}
	}
	// Older catalog entries encode inputs as undeclared brace placeholders.
	let unresolved: Vec<String> = placeholder_names(&template)
		.into_iter()
		.filter(|name| !variables.contains_key(name))
		.collect();
	for name in &unresolved {
		let unresolved_id = if unresolved.len() == 1 {
			id.to_string()
		} else {
			format!("{id}.{}", sanitize_input_id(name))
		};
		let unresolved_label = if unresolved.len() == 1 { label } else { name };
		push_input(inputs, &unresolved_id, unresolved_label, input);
		variables.insert(name.clone(), unresolved_id);
	}

	McpCatalogValue {
		template,
		variables,
	}
}

fn placeholder_names(template: &str) -> Vec<String> {
	let mut names = Vec::new();
	let mut rest = template;
	while let Some(open) = rest.find('{') {
		rest = &rest[open + 1..];
		let Some(close) = rest.find('}') else {
			break;
		};
		let name = &rest[..close];
		if !name.is_empty()
			&& name.chars().all(|character| {
				character.is_ascii_alphanumeric() || character == '_'
			}) && !names.iter().any(|existing| existing == name)
		{
			names.push(name.to_string());
		}
		rest = &rest[close + 1..];
	}
	names
}

fn push_input(
	inputs: &mut Vec<McpCatalogInput>,
	id: &str,
	label: &str,
	input: &RegistryInput,
) {
	inputs.push(McpCatalogInput {
		id: id.to_string(),
		label: label.to_string(),
		default: input.default.clone().filter(|value| !value.is_empty()),
		placeholder: input
			.placeholder
			.clone()
			.filter(|value| !value.is_empty()),
		description: input
			.description
			.clone()
			.filter(|value| !value.is_empty()),
		is_required: input.is_required,
		is_secret: input.is_secret,
		format: input.format.clone(),
		choices: input.choices.clone(),
	});
}

fn literal_value(value: String) -> McpCatalogValue {
	McpCatalogValue {
		template: value,
		variables: BTreeMap::new(),
	}
}

fn sanitize_input_id(raw: &str) -> String {
	raw.chars()
		.map(|character| {
			if character.is_ascii_alphanumeric()
				|| matches!(character, '-' | '_')
			{
				character.to_ascii_lowercase()
			} else {
				'-'
			}
		})
		.collect()
}

fn is_http_url(raw: &str) -> bool {
	url::Url::parse(raw).is_ok_and(|url| {
		matches!(url.scheme(), "http" | "https")
			&& url.host_str().is_some()
			&& url.username().is_empty()
			&& url.password().is_none()
	})
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
			.filter_map(entry_from_value)
			.collect()
	}

	fn stdio(
		server: &McpCatalogEntry,
	) -> (&str, &[McpCatalogArgument], &[McpCatalogKeyValue]) {
		match &server.install_methods[0].transport {
			McpCatalogTransport::Stdio { command, args, env } => {
				(command, args, env)
			}
			_ => panic!("expected stdio transport"),
		}
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
		let (command, args, env) = stdio(server);
		assert_eq!(command, "npx");
		assert_eq!(
			args.iter()
				.map(|argument| argument.value.template.as_str())
				.collect::<Vec<_>>(),
			vec!["-y", "remote-filesystem-mcp-server@0.1.3"]
		);
		assert_eq!(env.len(), 4);
		assert_eq!(env[2].value.template, "{your_api_key}");
		let inputs = &server.install_methods[0].inputs;
		assert_eq!(inputs.len(), 4);
		assert_eq!(inputs[0].label, "GCS_BUCKET");
		assert!(inputs[0].is_required);
		assert!(inputs[1].is_secret);
		assert_eq!(inputs[2].label, "API_KEY");
		assert!(inputs[2].is_secret);
		assert_eq!(inputs[3].default.as_deref(), Some("us-east-1"));
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
		let method = &server.install_methods[0];
		let (url, headers) = match &method.transport {
			McpCatalogTransport::StreamableHttp { url, headers } => {
				(url, headers)
			}
			_ => panic!("expected streamable HTTP transport"),
		};
		assert_eq!(url.template, "https://server.smithery.ai/example/mcp");
		assert_eq!(headers.len(), 1);
		assert_eq!(headers[0].name, "Authorization");
		assert_eq!(headers[0].value.template, "Bearer {smithery_api_key}");
		assert_eq!(method.inputs.len(), 1);
		assert_eq!(method.inputs[0].label, "Authorization");
		assert!(method.inputs[0].is_required);
		assert!(method.inputs[0].is_secret);
	}

	#[test]
	fn derives_command_from_registry_type_without_hint() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/py-server",
				"description":"py",
				"version":"2.0.0",
				"packages":[{"registryType":"pypi","identifier":"acme-mcp","version":"2.0.0","transport":{"type":"stdio"}}]
			},"_meta":{}}]}"#,
		);

		assert_eq!(servers.len(), 1);
		let (command, args, _) = stdio(&servers[0]);
		assert_eq!(command, "uvx");
		assert_eq!(args.len(), 1);
		assert_eq!(args[0].value.template, "acme-mcp@2.0.0");
	}

	#[test]
	fn adds_non_interactive_runtime_arguments() {
		let npm = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/npm",
				"description":"npm",
				"version":"1.0.0",
				"packages":[{"registryType":"npm","identifier":"acme-mcp","version":"1.2.3","transport":{"type":"stdio"}}]
			},"_meta":{}}]}"#,
		);
		let oci = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/oci",
				"description":"oci",
				"version":"1.0.0",
				"packages":[{"registryType":"oci","identifier":"ghcr.io/acme/mcp:1.0.0","transport":{"type":"stdio"}}]
			},"_meta":{}}]}"#,
		);

		let (_, npm_args, _) = stdio(&npm[0]);
		assert_eq!(
			npm_args
				.iter()
				.map(|argument| argument.value.template.as_str())
				.collect::<Vec<_>>(),
			vec!["-y", "acme-mcp@1.2.3"],
		);
		let (_, oci_args, _) = stdio(&oci[0]);
		assert_eq!(
			oci_args
				.iter()
				.map(|argument| argument.value.template.as_str())
				.collect::<Vec<_>>(),
			vec!["run", "-i", "--rm", "ghcr.io/acme/mcp:1.0.0"],
		);
	}

	#[test]
	fn keeps_runtime_defaults_with_declared_arguments() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/oci",
				"description":"oci",
				"version":"1.0.0",
				"packages":[{
					"registryType":"oci",
					"identifier":"ghcr.io/acme/mcp:1.0.0",
					"transport":{"type":"stdio"},
					"runtimeArguments":[{"type":"named","name":"--network","value":"host"}]
				}]
			},"_meta":{}}]}"#,
		);

		let (_, args, _) = stdio(&servers[0]);
		assert_eq!(
			args.iter()
				.map(|argument| (
					argument.name.as_deref(),
					argument.value.template.as_str(),
				))
				.collect::<Vec<_>>(),
			vec![
				(None, "run"),
				(None, "-i"),
				(None, "--rm"),
				(Some("--network"), "host"),
				(None, "ghcr.io/acme/mcp:1.0.0"),
			],
		);
	}

	#[test]
	fn builds_versioned_nuget_invocation() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/nuget",
				"description":"nuget",
				"version":"0.4.0-beta",
				"packages":[{
					"registryType":"nuget",
					"identifier":"Acme.Mcp",
					"version":"0.4.0-beta",
					"transport":{"type":"stdio"},
					"packageArguments":[{"type":"positional","value":"mcp"}]
				}]
			},"_meta":{}}]}"#,
		);

		let (command, args, _) = stdio(&servers[0]);
		assert_eq!(command, "dnx");
		assert_eq!(
			args.iter()
				.map(|argument| argument.value.template.as_str())
				.collect::<Vec<_>>(),
			vec!["Acme.Mcp@0.4.0-beta", "--", "mcp"],
		);
	}

	#[test]
	fn keeps_runtime_and_package_inputs_in_command_order() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/configurable",
				"description":"configurable",
				"version":"1.0.0",
				"packages":[{
					"registryType":"npm",
					"identifier":"acme-mcp",
					"runtimeHint":"npx",
					"transport":{"type":"stdio"},
					"runtimeArguments":[
						{"type":"positional","value":"-y"},
						{"type":"named","name":"--registry","default":"corp"}
					],
					"packageArguments":[
						{"type":"positional","valueHint":"path","default":"/tmp/data","isRequired":true}
					]
				}]
			},"_meta":{}}]}"#,
		);

		assert_eq!(servers.len(), 1);
		let (_, args, _) = stdio(&servers[0]);
		assert_eq!(
			args.iter()
				.map(|argument| (
					argument.name.as_deref(),
					argument.value.template.as_str(),
				))
				.collect::<Vec<_>>(),
			vec![
				(None, "-y"),
				(Some("--registry"), "{value}"),
				(None, "acme-mcp"),
				(None, "{value}"),
			],
		);
		let inputs = &servers[0].install_methods[0].inputs;
		assert_eq!(inputs.len(), 2);
		assert_eq!(inputs[0].default.as_deref(), Some("corp"));
		assert_eq!(inputs[1].label, "path");
		assert_eq!(inputs[1].default.as_deref(), Some("/tmp/data"));
		assert!(inputs[1].is_required);
	}

	#[test]
	fn keeps_remote_url_variables_configurable() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/remote",
				"description":"remote",
				"version":"1.0.0",
				"remotes":[{
					"type":"sse",
					"url":"https://{tenant}.example.test/sse",
					"variables":{"tenant":{"default":"acme","isRequired":true}}
				}]
			},"_meta":{}}]}"#,
		);

		let method = &servers[0].install_methods[0];
		let McpCatalogTransport::Sse { url, .. } = &method.transport else {
			panic!("expected SSE transport");
		};
		assert_eq!(url.template, "https://{tenant}.example.test/sse");
		assert_eq!(
			url.variables.get("tenant"),
			Some(&"remote.url.tenant".to_string())
		);
		assert_eq!(method.inputs.len(), 1);
		assert_eq!(method.inputs[0].label, "tenant");
		assert_eq!(method.inputs[0].default.as_deref(), Some("acme"));
		assert!(method.inputs[0].is_required);
	}

	#[test]
	fn keeps_all_supported_install_methods() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/multi-method",
				"description":"multiple install methods",
				"version":"1.0.0",
				"packages":[
					{"registryType":"npm","identifier":"acme-mcp","version":"1.0.0","transport":{"type":"stdio"}},
					{"registryType":"pypi","identifier":"acme-mcp","version":"1.0.0","transport":{"type":"stdio"}}
				],
				"remotes":[{
					"type":"streamable-http",
					"url":"https://mcp.example.test"
				}]
			},"_meta":{}}]}"#,
		);

		assert_eq!(servers.len(), 1);
		assert_eq!(servers[0].install_methods.len(), 3);
		assert_eq!(servers[0].install_methods[0].id, "npm:acme-mcp");
		assert_eq!(servers[0].install_methods[1].id, "pypi:acme-mcp");
		assert_eq!(
			servers[0].install_methods[2].id,
			"streamable-http:https://mcp.example.test"
		);
		assert_eq!(
			servers[0].install_methods[2].label,
			"Streamable HTTP · https://mcp.example.test"
		);
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

	// The live registry returns entries with `repository: {}` (no url); a strict
	// required `url` field used to fail the whole response (502). Keep it shown.
	#[test]
	fn tolerates_empty_repository_object() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/empty-repo",
				"description":"empty repository object",
				"version":"1.0.0",
				"repository":{},
				"packages":[{"registryType":"npm","identifier":"acme","runtimeHint":"npx","transport":{"type":"stdio"}}]
			},"_meta":{}}]}"#,
		);

		assert_eq!(servers.len(), 1);
		assert!(servers[0].repository_url.is_none());
	}

	#[test]
	fn drops_unsafe_repository_url() {
		let servers = parse(
			r#"{"servers":[{"server":{
				"name":"io.github.acme/unsafe-repo",
				"description":"unsafe repository URL",
				"version":"1.0.0",
				"repository":{"url":"https://user:secret@example.test/repo"},
				"packages":[{"registryType":"npm","identifier":"acme","transport":{"type":"stdio"}}]
			},"_meta":{}}]}"#,
		);

		assert_eq!(servers.len(), 1);
		assert!(servers[0].repository_url.is_none());
	}

	// One malformed entry must not sink the whole batch.
	#[test]
	fn skips_malformed_entry_without_failing_batch() {
		let servers = parse(
			r#"{"servers":[
				{"server":{"name":"io.github.acme/good","description":"ok","version":"1.0.0","packages":[{"registryType":"npm","identifier":"good","runtimeHint":"npx","transport":{"type":"stdio"}}]},"_meta":{}},
				{"server":{"description":"missing name","version":"1.0.0"}},
				{"not-a-server":true}
			]}"#,
		);

		assert_eq!(servers.len(), 1);
		assert_eq!(servers[0].suggested_name, "good");
	}
}

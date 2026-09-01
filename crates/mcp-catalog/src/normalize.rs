use std::collections::BTreeMap;

use crate::{
	model::{
		McpCatalogArgument, McpCatalogEntry, McpCatalogInput,
		McpCatalogInstallMethod, McpCatalogKeyValue, McpCatalogPage,
		McpCatalogTransport, McpCatalogValue,
	},
	registry::*,
};

// npx must not pause for an install prompt; OCI stdio servers need an
// attached stdin and a disposable container for MCP's process lifetime.
const NPM_RUNTIME_ARGS: &[&str] = &["-y"];
const OCI_RUNTIME_ARGS: &[&str] = &["run", "-i", "--rm"];

pub(crate) fn map_page(response: ServerListResponse) -> McpCatalogPage {
	McpCatalogPage {
		servers: response.servers.into_iter().map(map_detail).collect(),
		next_cursor: response
			.metadata
			.next_cursor
			.filter(|cursor| !cursor.is_empty()),
	}
}

/// Keep catalog metadata even when no supported install method is declared.
pub(crate) fn map_detail(envelope: ServerEnvelope) -> McpCatalogEntry {
	let detail = envelope.server;
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
	McpCatalogEntry {
		name: detail.name,
		display_name,
		suggested_name,
		publisher,
		description: detail.description,
		version: detail.version,
		updated_at: envelope.metadata.registry.updated_at,
		published_at: envelope.metadata.registry.published_at,
		repository_url,
		install_methods,
	}
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
			requires_env: None,
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
	if package.registry_type == "oci" {
		for field in &package.environment_variables {
			args.push(McpCatalogArgument {
				name: Some("--env".to_string()),
				value: literal_value(field.name.clone()),
				requires_env: Some(field.name.clone()),
			});
		}
	}
	args.push(McpCatalogArgument {
		name: None,
		value: literal_value(package_reference(package)),
		requires_env: None,
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
			requires_env: None,
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
	Some(McpCatalogArgument {
		name,
		value,
		requires_env: None,
	})
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
mod tests;

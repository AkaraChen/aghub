use super::*;

fn parse(json: &str) -> Vec<McpCatalogEntry> {
	let response: ServerListResponse =
		serde_json::from_str(json).expect("valid registry json");
	map_page(response).servers
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
		McpCatalogTransport::StreamableHttp { url, headers } => (url, headers),
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
fn forwards_oci_environment_names_before_the_image() {
	let servers = parse(
		r#"{"servers":[{"server":{
			"name":"io.example/container",
			"packages":[{
				"registryType":"oci",
				"identifier":"ghcr.io/example/mcp:1.0.0",
				"environmentVariables":[
					{"name":"API_KEY","isSecret":true,"isRequired":true},
					{"name":"REGION","default":"eu-west-1"},
					{"name":"OPTIONAL_TOKEN","isSecret":true}
				],
				"packageArguments":[{"type":"positional","value":"serve"}]
			}]
		},"_meta":{}}]}"#,
	);
	let (command, args, env) = stdio(&servers[0]);
	assert_eq!(command, "docker");
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
			(Some("--env"), "API_KEY"),
			(Some("--env"), "REGION"),
			(Some("--env"), "OPTIONAL_TOKEN"),
			(None, "ghcr.io/example/mcp:1.0.0"),
			(None, "serve"),
		],
	);
	for (argument, field) in args[3..6].iter().zip(env) {
		let serialized = serde_json::to_value(argument).unwrap();
		assert_eq!(serialized["requires_env"], field.name);
		assert!(argument.value.variables.is_empty());
	}
	assert!(servers[0].install_methods[0].inputs[0].is_secret);
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
fn retains_entries_without_installable_method() {
	let servers = parse(
		r#"{"servers":[{"server":{
				"name":"io.github.acme/unknown",
				"description":"no usable package",
				"version":"1.0.0",
				"packages":[{"registryType":"mystery","identifier":"x","transport":{"type":"stdio"}}]
			},"_meta":{}}]}"#,
	);

	assert_eq!(servers.len(), 1);
	assert_eq!(servers[0].name, "io.github.acme/unknown");
	assert!(servers[0].install_methods.is_empty());
}

#[test]
fn retains_registry_update_time() {
	let servers = parse(
		r#"{"servers":[{"server":{
			"name":"io.github.acme/calendar", "version":"2.0.0",
			"remotes":[{"type":"streamable-http","url":"https://example.test/mcp"}]
		},"_meta":{"io.modelcontextprotocol.registry/official":{
			"updatedAt":"2026-08-31T10:00:00Z"
		}}}]}"#,
	);
	let serialized = serde_json::to_value(&servers[0]).unwrap();
	assert_eq!(serialized["updated_at"], "2026-08-31T10:00:00Z");
}

#[test]
fn retains_page_order_and_opaque_cursor() {
	let response = serde_json::from_value(serde_json::json!({
		"servers": [
			{"server": {"name": "test/z", "version": "2"}},
			{"server": {"name": "test/a", "version": "1"}}
		],
		"metadata": {"nextCursor": "test/a:1+/=&?"}
	}))
	.unwrap();
	let page = map_page(response);
	assert_eq!(page.servers[0].name, "test/z");
	assert_eq!(page.servers[1].name, "test/a");
	assert_eq!(page.next_cursor.as_deref(), Some("test/a:1+/=&?"));
	assert!(page.servers[0].updated_at.is_none());
	assert!(page.servers[0].published_at.is_none());
}

#[test]
fn recognizes_last_page_and_empty_intermediate_page() {
	for metadata in [
		serde_json::json!({}),
		serde_json::json!({"nextCursor": null}),
		serde_json::json!({"nextCursor": ""}),
	] {
		let response = serde_json::from_value(serde_json::json!({
			"servers": [], "metadata": metadata
		}))
		.unwrap();
		assert!(map_page(response).next_cursor.is_none());
	}
	let response = serde_json::from_value(serde_json::json!({
		"servers": [], "metadata": {"nextCursor": "next"}
	}))
	.unwrap();
	assert_eq!(map_page(response).next_cursor.as_deref(), Some("next"));
}

#[test]
fn rejects_a_response_without_a_server_list() {
	assert!(serde_json::from_str::<ServerListResponse>(
		r#"{"error":"catalog unavailable"}"#
	)
	.is_err());
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

#[test]
fn rejects_malformed_registry_entries() {
	let result = serde_json::from_str::<ServerListResponse>(
		r#"{"servers":[
				{"server":{"name":"io.github.acme/good","description":"ok","version":"1.0.0","packages":[{"registryType":"npm","identifier":"good","runtimeHint":"npx","transport":{"type":"stdio"}}]},"_meta":{}},
				{"server":{"description":"missing name","version":"1.0.0"}},
				{"not-a-server":true}
			]}"#,
	);

	assert!(result.is_err());
}

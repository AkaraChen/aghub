use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{
	AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader,
};
use tokio::process::Command;

const APP_SERVER_TIMEOUT: Duration = Duration::from_secs(20);
const INITIALIZE_REQUEST_ID: u64 = 1;
const SKILLS_REQUEST_ID: u64 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CodexSkillOrigin {
	Standalone,
	Plugin { id: String },
	System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CodexSkillScope {
	User,
	Repo,
	System,
	Admin,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CodexSkillRecord {
	pub(crate) qualified_name: String,
	pub(crate) base_name: String,
	pub(crate) description: String,
	pub(crate) path: PathBuf,
	pub(crate) scope: CodexSkillScope,
	pub(crate) enabled: bool,
	pub(crate) origin: CodexSkillOrigin,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CodexSkillLoadError {
	pub(crate) cwd: String,
	pub(crate) path: String,
	pub(crate) message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct CodexSkillCatalog {
	pub(crate) skills: Vec<CodexSkillRecord>,
	pub(crate) errors: Vec<CodexSkillLoadError>,
}

pub(crate) struct CodexSkillsClient {
	binary: PathBuf,
}

impl CodexSkillsClient {
	pub(crate) fn new() -> Result<Self> {
		let binary =
			which::which("codex").context("codex CLI not found in PATH")?;
		Ok(Self { binary })
	}

	pub(crate) async fn list_skills(
		&self,
		cwds: &[PathBuf],
	) -> Result<CodexSkillCatalog> {
		tokio::time::timeout(APP_SERVER_TIMEOUT, self.list_skills_inner(cwds))
			.await
			.context("codex app-server skills/list timed out")?
	}

	async fn list_skills_inner(
		&self,
		cwds: &[PathBuf],
	) -> Result<CodexSkillCatalog> {
		let mut command = Command::new(&self.binary);
		command
			.arg("app-server")
			.stdin(Stdio::piped())
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			.kill_on_drop(true);
		#[cfg(windows)]
		command.creation_flags(crate::CREATE_NO_WINDOW);
		let mut child = command
			.spawn()
			.context("failed to start codex app-server")?;
		let mut stdin = child
			.stdin
			.take()
			.context("codex app-server stdin is unavailable")?;
		let stdout = child
			.stdout
			.take()
			.context("codex app-server stdout is unavailable")?;
		let mut stderr = child
			.stderr
			.take()
			.context("codex app-server stderr is unavailable")?;
		let stderr_task = tokio::spawn(async move {
			let mut output = String::new();
			stderr.read_to_string(&mut output).await.map(|_| output)
		});

		let mut lines = BufReader::new(stdout).lines();
		let skills_response =
			request_skills(&mut stdin, &mut lines, cwds).await;
		drop(stdin);
		let _ = child.kill().await;
		let _ = child.wait().await;
		let diagnostics = stderr_task
			.await
			.context("failed to join codex app-server diagnostics")?
			.context("failed to read codex app-server diagnostics")?;
		let skills_response = skills_response.with_context(|| {
			let diagnostics = diagnostics.trim();
			if diagnostics.is_empty() {
				"codex app-server request failed".to_string()
			} else {
				format!("codex app-server request failed: {diagnostics}")
			}
		})?;
		parse_skills_value(skills_response, SKILLS_REQUEST_ID)
	}
}

async fn request_skills<R>(
	stdin: &mut tokio::process::ChildStdin,
	lines: &mut tokio::io::Lines<R>,
	cwds: &[PathBuf],
) -> Result<serde_json::Value>
where
	R: AsyncBufRead + Unpin,
{
	write_request(
		stdin,
		INITIALIZE_REQUEST_ID,
		"initialize",
		serde_json::json!({
			"clientInfo": {
				"name": "aghub",
				"title": "aghub",
				"version": env!("CARGO_PKG_VERSION")
			}
		}),
	)
	.await?;
	let initialize_response =
		read_response(lines, INITIALIZE_REQUEST_ID).await?;
	ensure_response_succeeded(&initialize_response, INITIALIZE_REQUEST_ID)?;
	write_notification(stdin, "initialized", serde_json::json!({})).await?;
	write_request(
		stdin,
		SKILLS_REQUEST_ID,
		"skills/list",
		serde_json::json!({
			"cwds": cwds,
			"forceReload": false
		}),
	)
	.await?;
	read_response(lines, SKILLS_REQUEST_ID).await
}

async fn read_response<R>(
	lines: &mut tokio::io::Lines<R>,
	request_id: u64,
) -> Result<serde_json::Value>
where
	R: AsyncBufRead + Unpin,
{
	while let Some(line) = lines
		.next_line()
		.await
		.context("failed to read codex app-server response")?
	{
		let Ok(message) = serde_json::from_str::<serde_json::Value>(&line)
		else {
			continue;
		};
		if message.get("id").and_then(serde_json::Value::as_u64)
			== Some(request_id)
		{
			return Ok(message);
		}
	}
	anyhow::bail!("codex app-server response stream closed")
}

fn ensure_response_succeeded(
	value: &serde_json::Value,
	request_id: u64,
) -> Result<()> {
	if value.get("id").and_then(serde_json::Value::as_u64) != Some(request_id) {
		anyhow::bail!("unexpected codex app-server response id");
	}
	if let Some(error) = value.get("error") {
		let code = error
			.get("code")
			.and_then(serde_json::Value::as_i64)
			.unwrap_or_default();
		let message = error
			.get("message")
			.and_then(serde_json::Value::as_str)
			.unwrap_or("unknown error");
		anyhow::bail!("codex app-server request failed ({code}): {message}");
	}
	Ok(())
}

async fn write_request(
	stdin: &mut tokio::process::ChildStdin,
	id: u64,
	method: &str,
	params: serde_json::Value,
) -> Result<()> {
	write_message(
		stdin,
		&serde_json::json!({
			"id": id,
			"method": method,
			"params": params
		}),
	)
	.await
}

async fn write_notification(
	stdin: &mut tokio::process::ChildStdin,
	method: &str,
	params: serde_json::Value,
) -> Result<()> {
	write_message(
		stdin,
		&serde_json::json!({
			"method": method,
			"params": params
		}),
	)
	.await
}

async fn write_message(
	stdin: &mut tokio::process::ChildStdin,
	message: &serde_json::Value,
) -> Result<()> {
	let mut encoded = serde_json::to_vec(message)
		.context("failed to encode codex app-server request")?;
	encoded.push(b'\n');
	stdin
		.write_all(&encoded)
		.await
		.context("failed to write codex app-server request")?;
	stdin
		.flush()
		.await
		.context("failed to flush codex app-server request")
}

#[derive(Debug, Deserialize)]
struct SkillsListResult {
	data: Vec<SkillsListEntry>,
}

#[derive(Debug, Deserialize)]
struct SkillsListEntry {
	cwd: String,
	skills: Vec<SkillMetadata>,
	errors: Vec<SkillErrorInfo>,
}

#[derive(Debug, Deserialize)]
struct SkillMetadata {
	name: String,
	description: String,
	enabled: bool,
	#[serde(default, rename = "pluginId")]
	plugin_id: Option<String>,
	path: PathBuf,
	scope: CodexSkillScope,
}

#[derive(Debug, Deserialize)]
struct SkillErrorInfo {
	path: String,
	message: String,
}

#[derive(Debug, Deserialize)]
struct RpcError {
	code: i64,
	message: String,
}

#[derive(Debug, Deserialize)]
struct RpcResponse {
	id: u64,
	result: Option<SkillsListResult>,
	error: Option<RpcError>,
}

#[cfg(test)]
fn parse_skills_response(
	response: &str,
	request_id: u64,
) -> Result<CodexSkillCatalog> {
	let value = serde_json::from_str(response)
		.context("failed to parse codex app-server response")?;
	parse_skills_value(value, request_id)
}

fn parse_skills_value(
	value: serde_json::Value,
	request_id: u64,
) -> Result<CodexSkillCatalog> {
	let response: RpcResponse = serde_json::from_value(value)
		.context("failed to decode codex skills/list response")?;
	if response.id != request_id {
		anyhow::bail!(
			"unexpected codex app-server response id: {}",
			response.id
		);
	}
	if let Some(error) = response.error {
		anyhow::bail!(
			"codex skills/list failed ({}): {}",
			error.code,
			error.message
		);
	}
	let result = response
		.result
		.context("codex skills/list response has no result")?;
	Ok(build_catalog(result))
}

fn build_catalog(result: SkillsListResult) -> CodexSkillCatalog {
	let mut skills: BTreeMap<(String, PathBuf), CodexSkillRecord> =
		BTreeMap::new();
	let mut errors = Vec::new();

	for entry in result.data {
		for skill in entry.skills {
			let key = (skill.name.clone(), skill.path.clone());
			skills.entry(key).or_insert_with(|| {
				let (base_name, origin) = skill_identity(
					&skill.name,
					skill.scope,
					skill.plugin_id.as_deref(),
				);
				CodexSkillRecord {
					qualified_name: skill.name,
					base_name,
					description: skill.description,
					path: skill.path,
					scope: skill.scope,
					enabled: skill.enabled,
					origin,
				}
			});
		}
		for error in entry.errors {
			errors.push(CodexSkillLoadError {
				cwd: entry.cwd.clone(),
				path: error.path,
				message: error.message,
			});
		}
	}

	CodexSkillCatalog {
		skills: skills.into_values().collect(),
		errors,
	}
}

fn skill_identity(
	qualified_name: &str,
	scope: CodexSkillScope,
	plugin_id: Option<&str>,
) -> (String, CodexSkillOrigin) {
	if let Some(plugin_id) = plugin_id {
		let base_name = qualified_name
			.split_once(':')
			.map_or(qualified_name, |(_, base_name)| base_name);
		return (
			base_name.to_string(),
			CodexSkillOrigin::Plugin {
				id: plugin_id.to_string(),
			},
		);
	}
	if let Some((namespace, base_name)) = qualified_name.split_once(':') {
		return (
			base_name.to_string(),
			CodexSkillOrigin::Plugin {
				id: namespace.to_string(),
			},
		);
	}
	if scope == CodexSkillScope::System {
		return (qualified_name.to_string(), CodexSkillOrigin::System);
	}
	(qualified_name.to_string(), CodexSkillOrigin::Standalone)
}

#[cfg(test)]
mod tests {
	use super::*;

	const SKILLS_RESPONSE: &str = r#"{
		"id": 2,
		"result": {
			"data": [
				{
					"cwd": "/workspace/one",
					"skills": [
						{
							"name": "agents-sdk",
							"description": "Standalone",
							"enabled": true,
							"path": "/home/user/.agents/skills/agents-sdk/SKILL.md",
							"scope": "user"
						},
						{
							"name": "cloudflare:agents-sdk",
							"description": "Plugin",
							"enabled": true,
							"path": "/home/user/.codex/plugins/cache/openai-curated-remote/cloudflare/0.1.2/skills/agents-sdk/SKILL.md",
							"scope": "user"
						},
						{
							"name": "openai-docs",
							"description": "System",
							"enabled": true,
							"path": "/app/system/skills/openai-docs/SKILL.md",
							"scope": "system"
						}
					],
					"errors": [
						{
							"path": "/workspace/one/broken/SKILL.md",
							"message": "invalid frontmatter"
						}
					]
				},
				{
					"cwd": "/workspace/two",
					"skills": [
						{
							"name": "cloudflare:agents-sdk",
							"description": "Plugin",
							"enabled": true,
							"path": "/home/user/.codex/plugins/cache/openai-curated-remote/cloudflare/0.1.2/skills/agents-sdk/SKILL.md",
							"scope": "user"
						}
					],
					"errors": []
				}
			]
		}
	}"#;

	#[test]
	fn parses_runtime_names_without_merging_distinct_origins() {
		let catalog =
			parse_skills_response(SKILLS_RESPONSE, 2).expect("skills response");

		assert_eq!(catalog.skills.len(), 3);
		let standalone = catalog
			.skills
			.iter()
			.find(|skill| skill.qualified_name == "agents-sdk")
			.expect("standalone skill");
		assert_eq!(standalone.base_name, "agents-sdk");
		assert_eq!(standalone.origin, CodexSkillOrigin::Standalone);

		let plugin = catalog
			.skills
			.iter()
			.find(|skill| skill.qualified_name == "cloudflare:agents-sdk")
			.expect("plugin skill");
		assert_eq!(plugin.base_name, "agents-sdk");
		assert_eq!(
			plugin.origin,
			CodexSkillOrigin::Plugin {
				id: "cloudflare".to_string(),
			}
		);

		let system = catalog
			.skills
			.iter()
			.find(|skill| skill.qualified_name == "openai-docs")
			.expect("system skill");
		assert_eq!(system.origin, CodexSkillOrigin::System);
	}

	#[test]
	fn preserves_partial_discovery_errors() {
		let catalog =
			parse_skills_response(SKILLS_RESPONSE, 2).expect("skills response");

		assert_eq!(catalog.errors.len(), 1);
		assert_eq!(catalog.errors[0].cwd, "/workspace/one");
		assert_eq!(catalog.errors[0].path, "/workspace/one/broken/SKILL.md");
	}

	#[test]
	fn uses_explicit_plugin_id_without_a_qualified_name() {
		let response = r#"{
			"id": 2,
			"result": {
				"data": [{
					"cwd": "/workspace",
					"skills": [{
						"name": "agents-sdk",
						"description": "Plugin Skill",
						"enabled": true,
						"pluginId": "cloudflare@openai-curated-remote",
						"path": "/home/user/.codex/plugins/cache/cloudflare/skills/agents-sdk/SKILL.md",
						"scope": "user"
					}],
					"errors": []
				}]
			}
		}"#;

		let catalog =
			parse_skills_response(response, 2).expect("skills response");

		assert_eq!(catalog.skills[0].base_name, "agents-sdk");
		assert_eq!(
			catalog.skills[0].origin,
			CodexSkillOrigin::Plugin {
				id: "cloudflare@openai-curated-remote".to_string(),
			}
		);
	}

	#[tokio::test]
	#[ignore = "requires an installed Codex CLI"]
	async fn reads_skills_from_installed_codex() {
		let client = CodexSkillsClient::new().expect("installed codex CLI");
		let cwd = std::env::current_dir().expect("current directory");

		let catalog = client.list_skills(&[cwd]).await.expect("skills/list");

		assert!(catalog.skills.iter().all(|skill| skill
			.path
			.file_name()
			.is_some_and(|name| name == "SKILL.md")));
		let distinct = catalog
			.skills
			.iter()
			.map(|skill| (&skill.qualified_name, &skill.path))
			.collect::<std::collections::BTreeSet<_>>();
		assert_eq!(distinct.len(), catalog.skills.len());
	}
}

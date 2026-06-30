use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};

use crate::{format_path_with_tilde, AgentType, ConfigError, Result};

pub type HookMap = BTreeMap<String, Vec<HookMatcherGroup>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookSourceKind {
	ClaudeSettings,
	CodexHooksJson,
	CodexConfigToml,
}

impl HookSourceKind {
	fn id(self) -> &'static str {
		match self {
			Self::ClaudeSettings => "claude-settings",
			Self::CodexHooksJson => "codex-hooks-json",
			Self::CodexConfigToml => "codex-config-toml",
		}
	}

	fn parse(value: &str) -> Option<Self> {
		match value {
			"claude-settings" => Some(Self::ClaudeSettings),
			"codex-hooks-json" => Some(Self::CodexHooksJson),
			"codex-config-toml" => Some(Self::CodexConfigToml),
			_ => None,
		}
	}
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct HookAction {
	#[serde(rename = "type")]
	pub action_type: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub command: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub args: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub prompt: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub server: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub tool: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub timeout: Option<u32>,
	#[serde(
		rename = "statusMessage",
		alias = "status_message",
		skip_serializing_if = "Option::is_none"
	)]
	pub status_message: Option<String>,
	#[serde(rename = "async", skip_serializing_if = "Option::is_none")]
	pub is_async: Option<bool>,
	#[serde(rename = "if", skip_serializing_if = "Option::is_none")]
	pub if_condition: Option<String>,
	#[serde(flatten)]
	pub extra: JsonMap<String, JsonValue>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct HookMatcherGroup {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub matcher: Option<String>,
	#[serde(default)]
	pub hooks: Vec<HookAction>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookRecord {
	pub id: String,
	pub agent: String,
	pub event: String,
	pub matcher: Option<String>,
	pub action: HookAction,
	pub source_path: String,
	pub source_kind: HookSourceKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HookInput {
	pub event: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub matcher: Option<String>,
	pub action: HookAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct JsonHookFile {
	#[serde(default)]
	hooks: HookMap,
	#[serde(flatten)]
	extra: JsonMap<String, JsonValue>,
}

#[derive(Debug)]
struct HookSource {
	kind: HookSourceKind,
	path: PathBuf,
	hooks: HookMap,
}

pub fn list_hooks(agent: AgentType) -> Result<Vec<HookRecord>> {
	let mut records = Vec::new();
	for source in load_sources(agent)? {
		records.extend(flatten_source(agent, &source));
	}
	Ok(records)
}

pub fn create_hook(agent: AgentType, input: HookInput) -> Result<HookRecord> {
	validate_input(agent, &input)?;
	let kind = default_write_source(agent)?;
	let mut source = load_source(kind)?;
	let inserted = input.clone();
	add_hook(&mut source.hooks, input);
	save_source(&source)?;
	matching_record(agent, &source, &inserted)
}

pub fn update_hook(
	agent: AgentType,
	id: &str,
	input: HookInput,
) -> Result<HookRecord> {
	validate_input(agent, &input)?;
	let (kind, ordinal) = parse_record_id(id)?;
	validate_source_agent(agent, kind)?;
	let mut source = load_source(kind)?;
	remove_hook_at(&mut source.hooks, ordinal)?;
	let inserted = input.clone();
	add_hook(&mut source.hooks, input);
	save_source(&source)?;
	matching_record(agent, &source, &inserted)
}

pub fn delete_hook(agent: AgentType, id: &str) -> Result<()> {
	let (kind, ordinal) = parse_record_id(id)?;
	validate_source_agent(agent, kind)?;
	let mut source = load_source(kind)?;
	remove_hook_at(&mut source.hooks, ordinal)?;
	save_source(&source)
}

fn load_sources(agent: AgentType) -> Result<Vec<HookSource>> {
	match agent {
		AgentType::Claude => {
			Ok(vec![load_source(HookSourceKind::ClaudeSettings)?])
		}
		AgentType::Codex => Ok(vec![
			load_source(HookSourceKind::CodexHooksJson)?,
			load_source(HookSourceKind::CodexConfigToml)?,
		]),
		_ => Err(ConfigError::unsupported_operation(
			"manage",
			"hooks",
			agent.as_str(),
		)),
	}
}

fn load_source(kind: HookSourceKind) -> Result<HookSource> {
	let path = source_path(kind)?;
	let hooks = match kind {
		HookSourceKind::ClaudeSettings | HookSourceKind::CodexHooksJson => {
			load_json_hooks(&path)?.hooks
		}
		HookSourceKind::CodexConfigToml => {
			let root = load_toml_root(&path)?;
			hooks_from_toml(&root)?
		}
	};
	Ok(HookSource { kind, path, hooks })
}

fn save_source(source: &HookSource) -> Result<()> {
	match source.kind {
		HookSourceKind::ClaudeSettings | HookSourceKind::CodexHooksJson => {
			let mut file = load_json_hooks(&source.path)?;
			file.hooks = source.hooks.clone();
			write_json_hooks(&source.path, &file)
		}
		HookSourceKind::CodexConfigToml => {
			let mut root = load_toml_root(&source.path)?;
			write_toml_hooks(&source.path, &mut root, &source.hooks)
		}
	}
}

fn validate_source_agent(agent: AgentType, kind: HookSourceKind) -> Result<()> {
	match (agent, kind) {
		(AgentType::Claude, HookSourceKind::ClaudeSettings)
		| (AgentType::Codex, HookSourceKind::CodexHooksJson)
		| (AgentType::Codex, HookSourceKind::CodexConfigToml) => Ok(()),
		_ => Err(ConfigError::resource_not_found(
			"hook",
			format!("{} hook source for {}", kind.id(), agent.as_str()),
		)),
	}
}

fn default_write_source(agent: AgentType) -> Result<HookSourceKind> {
	match agent {
		AgentType::Claude => Ok(HookSourceKind::ClaudeSettings),
		AgentType::Codex => Ok(HookSourceKind::CodexHooksJson),
		_ => Err(ConfigError::unsupported_operation(
			"manage",
			"hooks",
			agent.as_str(),
		)),
	}
}

fn validate_input(agent: AgentType, input: &HookInput) -> Result<()> {
	if input.event.trim().is_empty() {
		return Err(ConfigError::ValidationFailed(
			"hook event is required".to_string(),
		));
	}

	let action_type = input.action.action_type.trim();
	if action_type.is_empty() {
		return Err(ConfigError::ValidationFailed(
			"hook action type is required".to_string(),
		));
	}

	if agent == AgentType::Codex && action_type != "command" {
		return Err(ConfigError::ValidationFailed(
			"Codex hooks currently support command actions only".to_string(),
		));
	}

	if action_type == "command"
		&& input
			.action
			.command
			.as_deref()
			.unwrap_or_default()
			.trim()
			.is_empty()
	{
		return Err(ConfigError::ValidationFailed(
			"command hook actions require a command".to_string(),
		));
	}

	Ok(())
}

fn add_hook(map: &mut HookMap, input: HookInput) {
	let event = input.event.trim().to_string();
	let matcher = normalize_matcher(input.matcher);
	let groups = map.entry(event).or_default();
	if let Some(group) = groups.iter_mut().find(|g| g.matcher == matcher) {
		group.hooks.push(input.action);
		return;
	}
	groups.push(HookMatcherGroup {
		matcher,
		hooks: vec![input.action],
	});
}

fn remove_hook_at(map: &mut HookMap, ordinal: usize) -> Result<HookAction> {
	let mut seen = 0usize;
	let events = map.keys().cloned().collect::<Vec<_>>();

	for event in events {
		let Some(groups) = map.get_mut(&event) else {
			continue;
		};
		let mut group_idx = 0usize;
		while group_idx < groups.len() {
			let group_len = groups[group_idx].hooks.len();
			if ordinal < seen + group_len {
				let hook_idx = ordinal - seen;
				let removed = groups[group_idx].hooks.remove(hook_idx);
				if groups[group_idx].hooks.is_empty() {
					groups.remove(group_idx);
				}
				if groups.is_empty() {
					map.remove(&event);
				}
				return Ok(removed);
			}
			seen += group_len;
			group_idx += 1;
		}
	}

	Err(ConfigError::resource_not_found("hook", ordinal.to_string()))
}

fn matching_record(
	agent: AgentType,
	source: &HookSource,
	input: &HookInput,
) -> Result<HookRecord> {
	let matcher = normalize_matcher(input.matcher.clone());
	flatten_source(agent, source)
		.into_iter()
		.filter(|record| {
			record.event == input.event.trim()
				&& record.matcher == matcher
				&& record.action == input.action
		})
		.last()
		.ok_or_else(|| ConfigError::resource_not_found("hook", "new"))
}

fn normalize_matcher(matcher: Option<String>) -> Option<String> {
	matcher.and_then(|value| {
		let value = value.trim().to_string();
		if value.is_empty() {
			None
		} else {
			Some(value)
		}
	})
}

fn flatten_source(agent: AgentType, source: &HookSource) -> Vec<HookRecord> {
	let source_path = format_path_with_tilde(&source.path)
		.unwrap_or_else(|| source.path.to_string_lossy().to_string());
	let mut records = Vec::new();
	let mut ordinal = 0usize;
	for (event, groups) in &source.hooks {
		for group in groups {
			for action in &group.hooks {
				records.push(HookRecord {
					id: format!("{}:{ordinal}", source.kind.id()),
					agent: agent.as_str().to_string(),
					event: event.clone(),
					matcher: group.matcher.clone(),
					action: action.clone(),
					source_path: source_path.clone(),
					source_kind: source.kind,
				});
				ordinal += 1;
			}
		}
	}
	records
}

fn parse_record_id(id: &str) -> Result<(HookSourceKind, usize)> {
	let (kind, index) = id.split_once(':').ok_or_else(|| {
		ConfigError::ValidationFailed("invalid hook id".to_string())
	})?;
	let kind = HookSourceKind::parse(kind).ok_or_else(|| {
		ConfigError::ValidationFailed("invalid hook source".to_string())
	})?;
	let index = index.parse::<usize>().map_err(|_| {
		ConfigError::ValidationFailed("invalid hook index".to_string())
	})?;
	Ok((kind, index))
}

fn source_path(kind: HookSourceKind) -> Result<PathBuf> {
	let home = dirs::home_dir().ok_or_else(|| {
		ConfigError::InvalidConfig(
			"home directory is not available".to_string(),
		)
	})?;
	let path = match kind {
		HookSourceKind::ClaudeSettings => home.join(".claude/settings.json"),
		HookSourceKind::CodexHooksJson => home.join(".codex/hooks.json"),
		HookSourceKind::CodexConfigToml => home.join(".codex/config.toml"),
	};
	Ok(path)
}

fn load_json_hooks(path: &Path) -> Result<JsonHookFile> {
	if !path.exists() {
		return Ok(JsonHookFile::default());
	}
	let content = fs::read_to_string(path)?;
	if content.trim().is_empty() {
		return Ok(JsonHookFile::default());
	}
	Ok(serde_json::from_str(&content)?)
}

fn write_json_hooks(path: &Path, file: &JsonHookFile) -> Result<()> {
	let content = serde_json::to_string_pretty(file)?;
	write_file(path, format!("{content}\n").as_bytes())
}

fn load_toml_root(path: &Path) -> Result<toml::Value> {
	if !path.exists() {
		return Ok(toml::Value::Table(toml::Table::new()));
	}
	let content = fs::read_to_string(path)?;
	if content.trim().is_empty() {
		return Ok(toml::Value::Table(toml::Table::new()));
	}
	toml::from_str::<toml::Value>(&content).map_err(|err| {
		ConfigError::InvalidConfig(format!(
			"failed to parse {}: {err}",
			path.display()
		))
	})
}

fn hooks_from_toml(root: &toml::Value) -> Result<HookMap> {
	let mut map = HookMap::new();
	let Some(hooks) = root.get("hooks").and_then(toml::Value::as_table) else {
		return Ok(map);
	};

	for (event, value) in hooks {
		let json = serde_json::to_value(value).map_err(|err| {
			ConfigError::InvalidConfig(format!(
				"failed to convert TOML hooks for {event}: {err}"
			))
		})?;
		let groups = serde_json::from_value::<Vec<HookMatcherGroup>>(json)
			.map_err(|err| {
				ConfigError::InvalidConfig(format!(
					"invalid hook entries for {event}: {err}"
				))
			})?;
		if !groups.is_empty() {
			map.insert(event.clone(), groups);
		}
	}

	Ok(map)
}

fn write_toml_hooks(
	path: &Path,
	root: &mut toml::Value,
	hooks: &HookMap,
) -> Result<()> {
	let table = root.as_table_mut().ok_or_else(|| {
		ConfigError::InvalidConfig(
			"Codex config root must be a TOML table".to_string(),
		)
	})?;

	if hooks.is_empty() {
		table.remove("hooks");
	} else {
		let mut hooks_table = toml::Table::new();
		for (event, groups) in hooks {
			let value = toml::Value::try_from(groups).map_err(|err| {
				ConfigError::InvalidConfig(format!(
					"failed to serialize TOML hooks for {event}: {err}"
				))
			})?;
			hooks_table.insert(event.clone(), value);
		}
		table.insert("hooks".to_string(), toml::Value::Table(hooks_table));
	}

	let content = toml::to_string_pretty(root).map_err(|err| {
		ConfigError::InvalidConfig(format!(
			"failed to serialize {}: {err}",
			path.display()
		))
	})?;
	write_file(path, content.as_bytes())
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}
	fs::write(path, bytes)?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_codex_toml_hooks() {
		let content = r#"
model = "gpt-5"

[hooks]
PreToolUse = [
	{
		matcher = "Bash",
		hooks = [
			{
				type = "command",
				command = "echo ok",
				timeout = 5,
				statusMessage = "checking",
			},
		],
	},
]
"#;
		let root = toml::from_str::<toml::Value>(content).expect("toml");

		let hooks = hooks_from_toml(&root).expect("hooks");
		let groups = hooks.get("PreToolUse").expect("event");
		assert_eq!(groups.len(), 1);
		assert_eq!(groups[0].matcher.as_deref(), Some("Bash"));
		assert_eq!(groups[0].hooks[0].action_type, "command");
		assert_eq!(groups[0].hooks[0].command.as_deref(), Some("echo ok"));
		assert_eq!(
			groups[0].hooks[0].status_message.as_deref(),
			Some("checking")
		);
	}

	#[test]
	fn removes_hook_by_source_ordinal() {
		let mut hooks = HookMap::new();
		add_hook(
			&mut hooks,
			HookInput {
				event: "Stop".to_string(),
				matcher: None,
				action: HookAction {
					action_type: "command".to_string(),
					command: Some("echo first".to_string()),
					..HookAction::default()
				},
			},
		);
		add_hook(
			&mut hooks,
			HookInput {
				event: "Stop".to_string(),
				matcher: None,
				action: HookAction {
					action_type: "command".to_string(),
					command: Some("echo second".to_string()),
					..HookAction::default()
				},
			},
		);

		let removed = remove_hook_at(&mut hooks, 0).expect("removed");
		assert_eq!(removed.command.as_deref(), Some("echo first"));
		assert_eq!(
			hooks["Stop"][0].hooks[0].command.as_deref(),
			Some("echo second")
		);
	}
}

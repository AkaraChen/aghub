use aghub_core::hooks::{HookAction, HookInput, HookRecord, HookSourceKind};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum HookSourceKindDto {
	ClaudeSettings,
	CodexHooksJson,
	CodexConfigToml,
}

impl From<HookSourceKind> for HookSourceKindDto {
	fn from(value: HookSourceKind) -> Self {
		match value {
			HookSourceKind::ClaudeSettings => Self::ClaudeSettings,
			HookSourceKind::CodexHooksJson => Self::CodexHooksJson,
			HookSourceKind::CodexConfigToml => Self::CodexConfigToml,
		}
	}
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct HookActionDto {
	#[serde(rename = "type")]
	pub action_type: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub command: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub args: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub prompt: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub server: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub tool: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub timeout: Option<u32>,
	#[serde(rename = "statusMessage", skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub status_message: Option<String>,
	#[serde(rename = "async", skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub is_async: Option<bool>,
	#[serde(rename = "if", skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub if_condition: Option<String>,
}

impl From<HookAction> for HookActionDto {
	fn from(value: HookAction) -> Self {
		Self {
			action_type: value.action_type,
			command: value.command,
			args: value.args,
			url: value.url,
			prompt: value.prompt,
			server: value.server,
			tool: value.tool,
			timeout: value.timeout,
			status_message: value.status_message,
			is_async: value.is_async,
			if_condition: value.if_condition,
		}
	}
}

impl From<HookActionDto> for HookAction {
	fn from(value: HookActionDto) -> Self {
		Self {
			action_type: value.action_type,
			command: value.command,
			args: value.args,
			url: value.url,
			prompt: value.prompt,
			server: value.server,
			tool: value.tool,
			timeout: value.timeout,
			status_message: value.status_message,
			is_async: value.is_async,
			if_condition: value.if_condition,
			extra: Default::default(),
		}
	}
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct CreateHookRequest {
	pub event: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub matcher: Option<String>,
	pub action: HookActionDto,
}

impl From<CreateHookRequest> for HookInput {
	fn from(value: CreateHookRequest) -> Self {
		Self {
			event: value.event,
			matcher: value.matcher,
			action: value.action.into(),
		}
	}
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct UpdateHookRequest {
	pub event: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub matcher: Option<String>,
	pub action: HookActionDto,
}

impl From<UpdateHookRequest> for HookInput {
	fn from(value: UpdateHookRequest) -> Self {
		Self {
			event: value.event,
			matcher: value.matcher,
			action: value.action.into(),
		}
	}
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct HookResponse {
	pub id: String,
	pub agent: String,
	pub event: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub matcher: Option<String>,
	pub action: HookActionDto,
	pub source_path: String,
	pub source_kind: HookSourceKindDto,
}

impl From<HookRecord> for HookResponse {
	fn from(value: HookRecord) -> Self {
		Self {
			id: value.id,
			agent: value.agent,
			event: value.event,
			matcher: value.matcher,
			action: value.action.into(),
			source_path: value.source_path,
			source_kind: value.source_kind.into(),
		}
	}
}

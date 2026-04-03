use aghub_core::models::SubAgent;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dto::common::ConfigSource;

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateSubAgentRequest {
	pub name: String,
	pub description: Option<String>,
	pub instruction: Option<String>,
}

impl From<CreateSubAgentRequest> for SubAgent {
	fn from(req: CreateSubAgentRequest) -> Self {
		SubAgent {
			name: req.name,
			description: req.description,
			instruction: req.instruction,
			source_path: None,
			config_source: None,
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateSubAgentRequest {
	pub name: Option<String>,
	pub description: Option<String>,
	pub instruction: Option<String>,
}

impl From<UpdateSubAgentRequest> for aghub_core::manager::sub_agent::SubAgentPatch {
	fn from(req: UpdateSubAgentRequest) -> Self {
		Self {
			name: req.name,
			description: req.description,
			instruction: req.instruction,
		}
	}
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SubAgentResponse {
	pub name: String,
	pub description: Option<String>,
	pub instruction: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub source_path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub source: Option<ConfigSource>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub agent: Option<String>,
}

impl From<SubAgent> for SubAgentResponse {
	fn from(s: SubAgent) -> Self {
		SubAgentResponse::from(&s)
	}
}

impl From<&SubAgent> for SubAgentResponse {
	fn from(s: &SubAgent) -> Self {
		SubAgentResponse {
			name: s.name.clone(),
			description: s.description.clone(),
			instruction: s.instruction.clone(),
			source_path: s.source_path.clone(),
			source: s.config_source.map(Into::into),
			agent: None,
		}
	}
}

impl From<(SubAgent, &str)> for SubAgentResponse {
	fn from((s, agent_id): (SubAgent, &str)) -> Self {
		SubAgentResponse {
			agent: Some(agent_id.to_string()),
			..SubAgentResponse::from(s)
		}
	}
}

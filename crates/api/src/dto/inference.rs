use aghub_core::{
	models::{Credential, CredentialType},
	ProviderTransferItem, ProviderTransferResult, ProviderTransferStatus,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum CredentialTypeDto {
	Openai,
	Anthropic,
}

impl From<CredentialType> for CredentialTypeDto {
	fn from(value: CredentialType) -> Self {
		match value {
			CredentialType::Openai => CredentialTypeDto::Openai,
			CredentialType::Anthropic => CredentialTypeDto::Anthropic,
		}
	}
}

impl From<CredentialTypeDto> for CredentialType {
	fn from(value: CredentialTypeDto) -> Self {
		match value {
			CredentialTypeDto::Openai => CredentialType::Openai,
			CredentialTypeDto::Anthropic => CredentialType::Anthropic,
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateInferenceProviderRequest {
	pub name: String,
	#[serde(rename = "type")]
	pub r#type: CredentialTypeDto,
	pub base: String,
	pub key: Option<String>,
}

#[derive(Debug, Default, Deserialize, TS)]
#[ts(export)]
pub struct UpdateInferenceProviderRequest {
	pub name: Option<String>,
	#[serde(rename = "type")]
	pub r#type: Option<CredentialTypeDto>,
	pub base: Option<String>,
	pub key: Option<String>,
	#[serde(default)]
	pub clear_key: bool,
}

/// Provider secret is intentionally omitted from responses.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct InferenceProviderResponseDto {
	pub id: String,
	pub name: String,
	#[serde(rename = "type")]
	pub r#type: CredentialTypeDto,
	pub base: String,
	pub has_key: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct InferenceCredentialDto {
	pub name: String,
	#[serde(rename = "type")]
	pub r#type: CredentialTypeDto,
	pub base: Option<String>,
	pub has_key: bool,
}

impl From<Credential> for InferenceCredentialDto {
	fn from(value: Credential) -> Self {
		InferenceCredentialDto {
			name: value.name,
			r#type: value.r#type.into(),
			base: value.base,
			has_key: value.key.is_some(),
		}
	}
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ProviderTransferStatusDto {
	Imported,
	Skipped,
}

impl From<ProviderTransferStatus> for ProviderTransferStatusDto {
	fn from(value: ProviderTransferStatus) -> Self {
		match value {
			ProviderTransferStatus::Imported => {
				ProviderTransferStatusDto::Imported
			}
			ProviderTransferStatus::Skipped => {
				ProviderTransferStatusDto::Skipped
			}
		}
	}
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ProviderTransferItemDto {
	pub name: String,
	pub status: ProviderTransferStatusDto,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub reason: Option<String>,
}

impl From<ProviderTransferItem> for ProviderTransferItemDto {
	fn from(value: ProviderTransferItem) -> Self {
		ProviderTransferItemDto {
			name: value.name,
			status: value.status.into(),
			reason: value.reason,
		}
	}
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ProviderTransferResponseDto {
	pub imported_count: usize,
	pub skipped_count: usize,
	pub items: Vec<ProviderTransferItemDto>,
}

impl From<ProviderTransferResult> for ProviderTransferResponseDto {
	fn from(value: ProviderTransferResult) -> Self {
		ProviderTransferResponseDto {
			imported_count: value.imported_count,
			skipped_count: value.skipped_count,
			items: value.items.into_iter().map(Into::into).collect(),
		}
	}
}

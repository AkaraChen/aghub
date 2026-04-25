use aghub_inference::{
	CreateInferenceProvider, InferenceProvider, InferenceProviderFormat,
	UpdateInferenceProvider,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum InferenceProviderFormatDto {
	Anthropic,
	#[serde(rename = "openai_completions")]
	OpenAiCompletions,
	#[serde(rename = "openai_responses")]
	OpenAiResponses,
}

impl From<InferenceProviderFormat> for InferenceProviderFormatDto {
	fn from(value: InferenceProviderFormat) -> Self {
		match value {
			InferenceProviderFormat::Anthropic => Self::Anthropic,
			InferenceProviderFormat::OpenAiCompletions => {
				Self::OpenAiCompletions
			}
			InferenceProviderFormat::OpenAiResponses => Self::OpenAiResponses,
		}
	}
}

impl From<InferenceProviderFormatDto> for InferenceProviderFormat {
	fn from(value: InferenceProviderFormatDto) -> Self {
		match value {
			InferenceProviderFormatDto::Anthropic => Self::Anthropic,
			InferenceProviderFormatDto::OpenAiCompletions => {
				Self::OpenAiCompletions
			}
			InferenceProviderFormatDto::OpenAiResponses => {
				Self::OpenAiResponses
			}
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateInferenceProviderRequest {
	pub name: String,
	pub format: InferenceProviderFormatDto,
	pub api_base_url: String,
	pub api_key: String,
}

impl From<CreateInferenceProviderRequest> for CreateInferenceProvider {
	fn from(req: CreateInferenceProviderRequest) -> Self {
		CreateInferenceProvider {
			name: req.name,
			format: req.format.into(),
			api_base_url: req.api_base_url,
			api_key: req.api_key,
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateInferenceProviderRequest {
	pub name: Option<String>,
	pub format: Option<InferenceProviderFormatDto>,
	pub api_base_url: Option<String>,
	pub api_key: Option<String>,
}

impl From<UpdateInferenceProviderRequest> for UpdateInferenceProvider {
	fn from(req: UpdateInferenceProviderRequest) -> Self {
		UpdateInferenceProvider {
			name: req.name,
			format: req.format.map(Into::into),
			api_base_url: req.api_base_url,
			api_key: req.api_key,
		}
	}
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct InferenceProviderResponse {
	pub id: String,
	pub name: String,
	pub format: InferenceProviderFormatDto,
	pub api_base_url: String,
}

impl From<InferenceProvider> for InferenceProviderResponse {
	fn from(provider: InferenceProvider) -> Self {
		InferenceProviderResponse::from(&provider)
	}
}

impl From<&InferenceProvider> for InferenceProviderResponse {
	fn from(provider: &InferenceProvider) -> Self {
		InferenceProviderResponse {
			id: provider.id.clone(),
			name: provider.name.clone(),
			format: provider.format.into(),
			api_base_url: provider.api_base_url.clone(),
		}
	}
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct InferenceProviderPasswordResponse {
	pub name: String,
	pub api_key: String,
}

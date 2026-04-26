use aghub_inference::{
	AgentProviderBinding, AgentProviderCredential, AgentProviderModel,
	AgentProviderSource, CreateInferenceProvider, InferenceProvider,
	InferenceProviderFormat, UpdateInferenceProvider,
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
	pub display_name: String,
	pub format: InferenceProviderFormatDto,
	pub api_base_url: String,
	pub api_key: String,
	pub models: Option<Vec<String>>,
}

impl From<CreateInferenceProviderRequest> for CreateInferenceProvider {
	fn from(req: CreateInferenceProviderRequest) -> Self {
		CreateInferenceProvider {
			name: req.name,
			display_name: req.display_name,
			format: req.format.into(),
			api_base_url: req.api_base_url,
			api_key: req.api_key,
			models: req.models.unwrap_or_default(),
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateInferenceProviderRequest {
	pub name: Option<String>,
	pub display_name: Option<String>,
	pub format: Option<InferenceProviderFormatDto>,
	pub api_base_url: Option<String>,
	pub api_key: Option<String>,
	pub models: Option<Vec<String>>,
}

impl From<UpdateInferenceProviderRequest> for UpdateInferenceProvider {
	fn from(req: UpdateInferenceProviderRequest) -> Self {
		UpdateInferenceProvider {
			name: req.name,
			display_name: req.display_name,
			format: req.format.map(Into::into),
			api_base_url: req.api_base_url,
			api_key: req.api_key,
			models: req.models,
		}
	}
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct InferenceProviderResponse {
	pub id: String,
	pub name: String,
	pub display_name: String,
	pub format: InferenceProviderFormatDto,
	pub api_base_url: String,
	pub masked_api_key: String,
	pub models: Vec<String>,
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
			display_name: provider.display_name.clone(),
			format: provider.format.into(),
			api_base_url: provider.api_base_url.clone(),
			masked_api_key: provider.masked_api_key.clone(),
			models: provider.models.clone(),
		}
	}
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct InferenceProviderPasswordResponse {
	pub name: String,
	pub api_key: String,
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentProviderSourceDto {
	ClosedSlot,
	BuiltIn,
	Custom,
	StoredCredential,
}

impl From<AgentProviderSource> for AgentProviderSourceDto {
	fn from(value: AgentProviderSource) -> Self {
		match value {
			AgentProviderSource::ClosedSlot => Self::ClosedSlot,
			AgentProviderSource::BuiltIn => Self::BuiltIn,
			AgentProviderSource::Custom => Self::Custom,
			AgentProviderSource::StoredCredential => Self::StoredCredential,
		}
	}
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentProviderCredentialDto {
	None,
	EnvVar { name: String },
	AgentStore { id: Option<String> },
	Inline,
}

impl From<&AgentProviderCredential> for AgentProviderCredentialDto {
	fn from(value: &AgentProviderCredential) -> Self {
		match value {
			AgentProviderCredential::None => Self::None,
			AgentProviderCredential::EnvVar { name } => {
				Self::EnvVar { name: name.clone() }
			}
			AgentProviderCredential::AgentStore { id } => {
				Self::AgentStore { id: id.clone() }
			}
			AgentProviderCredential::Inline => Self::Inline,
		}
	}
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct AgentProviderModelResponse {
	pub id: String,
	pub name: Option<String>,
}

impl From<&AgentProviderModel> for AgentProviderModelResponse {
	fn from(value: &AgentProviderModel) -> Self {
		Self {
			id: value.id.clone(),
			name: value.name.clone(),
		}
	}
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct AgentProviderMatchedInferenceProviderResponse {
	pub id: String,
	pub name: String,
	pub display_name: String,
	pub model_count: usize,
}

impl From<&InferenceProvider>
	for AgentProviderMatchedInferenceProviderResponse
{
	fn from(provider: &InferenceProvider) -> Self {
		Self {
			id: provider.id.clone(),
			name: provider.name.clone(),
			display_name: provider.display_name.clone(),
			model_count: provider.models.len(),
		}
	}
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct AgentProviderResponse {
	pub id: String,
	pub source_provider_id: Option<String>,
	pub name: String,
	pub format: Option<InferenceProviderFormatDto>,
	pub api_base_url: Option<String>,
	pub credential: AgentProviderCredentialDto,
	pub models: Vec<AgentProviderModelResponse>,
	pub source: AgentProviderSourceDto,
	pub matched_inference_provider:
		Option<AgentProviderMatchedInferenceProviderResponse>,
}

impl From<AgentProviderBinding> for AgentProviderResponse {
	fn from(provider: AgentProviderBinding) -> Self {
		Self::from(&provider)
	}
}

impl From<&AgentProviderBinding> for AgentProviderResponse {
	fn from(provider: &AgentProviderBinding) -> Self {
		Self {
			id: provider.id.clone(),
			source_provider_id: provider.source_provider_id.clone(),
			name: provider.name.clone(),
			format: provider.format.map(Into::into),
			api_base_url: provider.api_base_url.clone(),
			credential: (&provider.credential).into(),
			models: provider
				.models
				.iter()
				.map(AgentProviderModelResponse::from)
				.collect(),
			source: provider.source.into(),
			matched_inference_provider: None,
		}
	}
}

impl AgentProviderResponse {
	pub fn with_matched_inference_provider(
		mut self,
		provider: &InferenceProvider,
	) -> Self {
		self.source_provider_id = Some(provider.id.clone());
		self.matched_inference_provider = Some(provider.into());
		self
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateAgentProviderRequest {
	pub inference_provider_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateAgentProviderRequest {
	pub name: Option<String>,
	pub api_key: Option<String>,
}

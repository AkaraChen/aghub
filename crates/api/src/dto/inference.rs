use aghub_inference::{
	AgentProviderBinding, AgentProviderBindingRow, AgentProviderCredential,
	AgentProviderModel, AgentProviderSource, CodexProfileState,
	CodexProviderState, CreateInferenceProvider, InferenceProvider,
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
	pub latin_name: String,
	pub display_name: String,
	pub format: InferenceProviderFormatDto,
	pub api_base_url: String,
	pub preset: Option<String>,
	pub api_key: String,
	pub models: Option<Vec<String>>,
}

impl From<CreateInferenceProviderRequest> for CreateInferenceProvider {
	fn from(req: CreateInferenceProviderRequest) -> Self {
		CreateInferenceProvider {
			latin_name: req.latin_name,
			display_name: req.display_name,
			format: req.format.into(),
			api_base_url: req.api_base_url,
			preset: req.preset,
			api_key: req.api_key,
			models: req.models.unwrap_or_default(),
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateInferenceProviderRequest {
	pub latin_name: Option<String>,
	pub display_name: Option<String>,
	pub format: Option<InferenceProviderFormatDto>,
	pub api_base_url: Option<String>,
	#[ts(optional)]
	pub preset: Option<Option<String>>,
	pub api_key: Option<String>,
	pub models: Option<Vec<String>>,
}

impl From<UpdateInferenceProviderRequest> for UpdateInferenceProvider {
	fn from(req: UpdateInferenceProviderRequest) -> Self {
		UpdateInferenceProvider {
			latin_name: req.latin_name,
			display_name: req.display_name,
			format: req.format.map(Into::into),
			api_base_url: req.api_base_url,
			preset: req.preset,
			api_key: req.api_key,
			models: req.models,
		}
	}
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct InferenceProviderResponse {
	pub id: String,
	pub latin_name: String,
	pub display_name: String,
	pub format: InferenceProviderFormatDto,
	pub api_base_url: String,
	pub preset: Option<String>,
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
			latin_name: provider.latin_name.clone(),
			display_name: provider.display_name.clone(),
			format: provider.format.into(),
			api_base_url: provider.api_base_url.clone(),
			preset: provider.preset.clone(),
			masked_api_key: provider.masked_api_key.clone(),
			models: provider.models.clone(),
		}
	}
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct InferenceProviderPasswordResponse {
	pub latin_name: String,
	pub api_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct InferenceProviderPresetResponse {
	pub id: String,
	pub name: String,
	pub api_base_url: String,
	pub format: InferenceProviderFormatDto,
	pub models: Vec<String>,
	pub logo: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub homepage: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub description: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct FetchInferenceProviderModelsRequest {
	pub format: InferenceProviderFormatDto,
	pub api_base_url: String,
	pub api_key: Option<String>,
	pub provider_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AgentProviderSourceDto {
	ClosedSlot,
	BuiltIn,
	Custom,
	StoredCredential,
	External,
}

impl From<AgentProviderSource> for AgentProviderSourceDto {
	fn from(value: AgentProviderSource) -> Self {
		match value {
			AgentProviderSource::ClosedSlot => Self::ClosedSlot,
			AgentProviderSource::BuiltIn => Self::BuiltIn,
			AgentProviderSource::Custom => Self::Custom,
			AgentProviderSource::StoredCredential => Self::StoredCredential,
			AgentProviderSource::External => Self::External,
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
	pub latin_name: String,
	pub display_name: String,
	pub model_count: usize,
}

impl From<&InferenceProvider>
	for AgentProviderMatchedInferenceProviderResponse
{
	fn from(provider: &InferenceProvider) -> Self {
		Self {
			id: provider.id.clone(),
			latin_name: provider.latin_name.clone(),
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
	pub model: Option<String>,
	pub haiku_model: Option<String>,
	pub sonnet_model: Option<String>,
	pub opus_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CodexProfileResponse {
	pub id: String,
	pub name: String,
	pub is_default: bool,
	pub is_active: bool,
	pub selected_provider_id: String,
	pub model: Option<String>,
}

impl From<&CodexProfileState> for CodexProfileResponse {
	fn from(profile: &CodexProfileState) -> Self {
		Self {
			id: profile.id.clone(),
			name: profile.name.clone(),
			is_default: profile.is_default,
			is_active: profile.is_active,
			selected_provider_id: profile.selected_provider_id.clone(),
			model: profile.model.clone(),
		}
	}
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CodexProviderStateResponse {
	pub active_profile_id: String,
	pub profiles: Vec<CodexProfileResponse>,
	pub providers: Vec<AgentProviderResponse>,
}

impl CodexProviderStateResponse {
	pub fn from_state(
		state: CodexProviderState,
		providers: Vec<AgentProviderResponse>,
	) -> Self {
		Self {
			active_profile_id: state.active_profile_id,
			profiles: state
				.profiles
				.iter()
				.map(CodexProfileResponse::from)
				.collect(),
			providers,
		}
	}
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
			model: None,
			haiku_model: None,
			sonnet_model: None,
			opus_model: None,
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

	pub fn with_agent_binding_models(
		mut self,
		row: &AgentProviderBindingRow,
	) -> Self {
		self.model = row.model.clone();
		self.haiku_model = row.haiku_model.clone();
		self.sonnet_model = row.sonnet_model.clone();
		self.opus_model = row.opus_model.clone();
		self
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateAgentProviderRequest {
	pub inference_provider_id: String,
	#[ts(optional)]
	pub model: Option<String>,
	#[ts(optional)]
	pub haiku_model: Option<String>,
	#[ts(optional)]
	pub sonnet_model: Option<String>,
	#[ts(optional)]
	pub opus_model: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateAgentProviderRequest {
	pub name: Option<String>,
	pub api_key: Option<String>,
	#[ts(optional)]
	pub model: Option<Option<String>>,
	#[ts(optional)]
	pub haiku_model: Option<Option<String>>,
	#[ts(optional)]
	pub sonnet_model: Option<Option<String>>,
	#[ts(optional)]
	pub opus_model: Option<Option<String>>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateCodexActiveProfileRequest {
	pub profile_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateCodexProfileProviderRequest {
	pub provider_id: String,
	#[ts(optional)]
	pub model: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ClaudeProviderStateResponse {
	pub providers: Vec<AgentProviderResponse>,
	pub active_provider_id: String,
	pub active_model: Option<String>,
	pub active_haiku_model: Option<String>,
	pub active_sonnet_model: Option<String>,
	pub active_opus_model: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateClaudeProviderRequest {
	pub api_base_url: Option<String>,
	pub api_key: Option<String>,
	pub model: Option<String>,
}

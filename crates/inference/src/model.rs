//! Inference provider data models.

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use crate::error::InferenceProviderError;

/// Wire format used by an inference provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InferenceProviderFormat {
	/// Anthropic Messages API compatible format.
	#[serde(rename = "anthropic")]
	Anthropic,

	/// OpenAI Chat Completions compatible format.
	#[serde(
		rename = "openai_completions",
		alias = "openai_completion",
		alias = "openai-chat-completions",
		alias = "openai_chat_completions"
	)]
	OpenAiCompletions,

	/// OpenAI Responses API compatible format.
	#[serde(
		rename = "openai_responses",
		alias = "openai_response",
		alias = "openai-responses"
	)]
	OpenAiResponses,
}

impl fmt::Display for InferenceProviderFormat {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		let value = match self {
			Self::Anthropic => "anthropic",
			Self::OpenAiCompletions => "openai_completions",
			Self::OpenAiResponses => "openai_responses",
		};
		f.write_str(value)
	}
}

impl FromStr for InferenceProviderFormat {
	type Err = InferenceProviderError;

	fn from_str(value: &str) -> Result<Self, Self::Err> {
		match value.trim().to_ascii_lowercase().as_str() {
			"anthropic" => Ok(Self::Anthropic),
			"openai_completion"
			| "openai_completions"
			| "openai-chat-completions"
			| "openai_chat_completions" => Ok(Self::OpenAiCompletions),
			"openai_response" | "openai_responses" | "openai-responses" => {
				Ok(Self::OpenAiResponses)
			}
			other => {
				Err(InferenceProviderError::InvalidFormat(other.to_string()))
			}
		}
	}
}

/// Persisted inference provider metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceProvider {
	/// Stable provider identifier.
	pub id: String,

	/// Stable provider key.
	pub name: String,

	/// User-visible provider name.
	pub display_name: String,

	/// Request/response format supported by this provider.
	pub format: InferenceProviderFormat,

	/// Base URL for provider API requests.
	pub api_base_url: String,

	/// Masked API key stored for preview only.
	pub masked_api_key: String,

	/// Model names supported by this provider.
	pub models: Vec<String>,
}

/// Provider creation input.
#[derive(Clone, Deserialize)]
pub struct CreateInferenceProvider {
	/// Stable provider key.
	pub name: String,

	/// User-visible provider name.
	pub display_name: String,

	/// Request/response format supported by this provider.
	pub format: InferenceProviderFormat,

	/// Base URL for provider API requests.
	pub api_base_url: String,

	/// Provider API key. This is write-only and never stored in JSON.
	pub api_key: String,

	/// Model names supported by this provider.
	#[serde(default)]
	pub models: Vec<String>,
}

impl fmt::Debug for CreateInferenceProvider {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.debug_struct("CreateInferenceProvider")
			.field("name", &self.name)
			.field("display_name", &self.display_name)
			.field("format", &self.format)
			.field("api_base_url", &self.api_base_url)
			.field("models", &self.models)
			.field("api_key", &"[redacted]")
			.finish()
	}
}

/// Provider update input.
#[derive(Clone, Default, Deserialize)]
pub struct UpdateInferenceProvider {
	/// Updated stable provider key.
	pub name: Option<String>,

	/// Updated user-visible provider name.
	pub display_name: Option<String>,

	/// Updated request/response format.
	pub format: Option<InferenceProviderFormat>,

	/// Updated base URL for provider API requests.
	pub api_base_url: Option<String>,

	/// Updated provider API key. This is write-only and never stored in JSON.
	pub api_key: Option<String>,

	/// Updated model names supported by this provider.
	pub models: Option<Vec<String>>,
}

impl fmt::Debug for UpdateInferenceProvider {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.debug_struct("UpdateInferenceProvider")
			.field("name", &self.name)
			.field("display_name", &self.display_name)
			.field("format", &self.format)
			.field("api_base_url", &self.api_base_url)
			.field("models", &self.models)
			.field("api_key", &self.api_key.as_ref().map(|_| "[redacted]"))
			.finish()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_format_serialization() {
		assert_eq!(
			serde_json::to_string(&InferenceProviderFormat::Anthropic).unwrap(),
			r#""anthropic""#
		);
		assert_eq!(
			serde_json::to_string(&InferenceProviderFormat::OpenAiCompletions)
				.unwrap(),
			r#""openai_completions""#
		);
		assert_eq!(
			serde_json::to_string(&InferenceProviderFormat::OpenAiResponses)
				.unwrap(),
			r#""openai_responses""#
		);
	}

	#[test]
	fn test_format_aliases() {
		let completions: InferenceProviderFormat =
			serde_json::from_str(r#""openai_completion""#).unwrap();
		let responses: InferenceProviderFormat =
			serde_json::from_str(r#""openai_response""#).unwrap();

		assert_eq!(completions, InferenceProviderFormat::OpenAiCompletions);
		assert_eq!(responses, InferenceProviderFormat::OpenAiResponses);
	}
}

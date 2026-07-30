//! Model discovery for inference-provider APIs.

use std::collections::HashSet;
use std::time::Duration;

use reqwest::{redirect::Policy, Client, StatusCode};
use serde::Deserialize;
use url::Url;

use crate::provider_endpoint::{model_list_url, ProviderEndpointError};
use crate::InferenceProviderFormat;

const MODEL_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(15);
// Provider model metadata should remain well below one MiB per page.
const MAX_MODEL_RESPONSE_BYTES: usize = 1024 * 1024;
// Ten pages bound upstream work when pages are empty or undersized.
const MAX_ANTHROPIC_PAGES: usize = 10;
// A 1000-item request keeps normal provider inventories to one page.
const ANTHROPIC_PAGE_SIZE: usize = 1000;
// The desktop renders this inventory directly, so one provider page is the
// maximum accepted list.
const MAX_DISCOVERED_MODELS: usize = ANTHROPIC_PAGE_SIZE;
// Model IDs are identifiers, not free-form provider metadata.
const MAX_MODEL_ID_BYTES: usize = 512;

/// Input needed to list models from one provider endpoint.
pub struct ModelDiscoveryRequest<'a> {
	/// Provider wire format, which determines authentication and pagination.
	pub format: InferenceProviderFormat,

	/// Provider API base URL.
	pub api_base_url: &'a str,

	/// API key sent only to the requested endpoint.
	pub api_key: &'a str,
}

/// Errors returned while discovering provider models.
#[derive(Debug, thiserror::Error)]
pub enum ModelDiscoveryError {
	/// The API base URL was empty.
	#[error("API Base URL is required")]
	EmptyApiBaseUrl,

	/// The API base URL could not be parsed.
	#[error("API Base URL is invalid")]
	InvalidApiBaseUrl,

	/// The API base URL is not a supported HTTP endpoint.
	#[error("API Base URL must be an HTTP or HTTPS URL without credentials")]
	UnsupportedApiBaseUrl,

	/// The HTTP client could not be constructed.
	#[error("failed to build model discovery client")]
	Client(#[source] reqwest::Error),

	/// The complete discovery operation exceeded its time limit.
	#[error("model discovery timed out")]
	Timeout,

	/// The provider request could not be sent.
	#[error("failed to fetch models: {0}")]
	Request(#[source] reqwest::Error),

	/// The provider returned a non-success status.
	#[error("model list endpoint returned HTTP {0}")]
	UpstreamStatus(StatusCode),

	/// The provider response could not be read.
	#[error("failed to read model list: {0}")]
	ReadResponse(#[source] reqwest::Error),

	/// One response page exceeded the byte limit.
	#[error("model list response exceeds {limit} bytes")]
	ResponseTooLarge {
		/// Maximum accepted bytes per response page.
		limit: usize,
	},

	/// The provider response was not a supported JSON shape.
	#[error("model list endpoint returned invalid JSON: {0}")]
	InvalidResponse(#[source] serde_json::Error),

	/// The provider returned more models than discovery accepts.
	#[error("model list contains more than {limit} models")]
	TooManyModels {
		/// Maximum accepted model count.
		limit: usize,
	},

	/// A provider model identifier exceeded the byte limit.
	#[error("model ID exceeds {limit} bytes")]
	ModelIdTooLong {
		/// Maximum accepted bytes per model identifier.
		limit: usize,
	},

	/// Anthropic indicated another page without a usable cursor.
	#[error("Anthropic model list is missing a pagination cursor")]
	MissingPaginationCursor,

	/// Anthropic repeated a cursor and would not make progress.
	#[error("Anthropic model list repeated its pagination cursor")]
	RepeatedPaginationCursor,

	/// Anthropic returned more pages than discovery accepts.
	#[error("Anthropic model list exceeds {limit} pages")]
	TooManyPages {
		/// Maximum accepted page count.
		limit: usize,
	},
}

impl From<ProviderEndpointError> for ModelDiscoveryError {
	fn from(error: ProviderEndpointError) -> Self {
		match error {
			ProviderEndpointError::Empty => Self::EmptyApiBaseUrl,
			ProviderEndpointError::Invalid => Self::InvalidApiBaseUrl,
			ProviderEndpointError::Unsupported => Self::UnsupportedApiBaseUrl,
		}
	}
}

#[derive(Deserialize)]
struct ModelListResponse {
	data: Vec<ModelListItem>,
	#[serde(default)]
	has_more: bool,
	#[serde(default)]
	last_id: Option<String>,
}

#[derive(Deserialize)]
struct ModelListItem {
	id: String,
}

/// Fetches and validates model identifiers from a provider.
pub async fn discover_models(
	request: ModelDiscoveryRequest<'_>,
) -> Result<Vec<String>, ModelDiscoveryError> {
	let client = Client::builder()
		.redirect(Policy::none())
		.build()
		.map_err(ModelDiscoveryError::Client)?;
	tokio::time::timeout(
		MODEL_DISCOVERY_TIMEOUT,
		discover_models_with_client(&client, request),
	)
	.await
	.map_err(|_| ModelDiscoveryError::Timeout)?
}

async fn discover_models_with_client(
	client: &Client,
	request: ModelDiscoveryRequest<'_>,
) -> Result<Vec<String>, ModelDiscoveryError> {
	let url = model_list_url(request.api_base_url)
		.map_err(ModelDiscoveryError::from)?;
	match request.format {
		InferenceProviderFormat::Anthropic => {
			discover_anthropic_models(client, url, request.api_key).await
		}
		InferenceProviderFormat::OpenAiCompletions
		| InferenceProviderFormat::OpenAiResponses => {
			let response = request_model_page(
				client,
				request.format,
				url,
				request.api_key,
			)
			.await?;
			let mut models = Vec::new();
			append_models(&mut models, response.data)?;
			sort_and_deduplicate(&mut models);
			Ok(models)
		}
	}
}

async fn discover_anthropic_models(
	client: &Client,
	mut url: Url,
	api_key: &str,
) -> Result<Vec<String>, ModelDiscoveryError> {
	remove_query_pair(&mut url, "after_id");
	remove_query_pair(&mut url, "before_id");
	set_query_pair(&mut url, "limit", &ANTHROPIC_PAGE_SIZE.to_string());
	let mut models = Vec::new();
	let mut cursor = None;
	let mut seen_cursors = HashSet::new();

	for _ in 0..MAX_ANTHROPIC_PAGES {
		let mut page_url = url.clone();
		if let Some(value) = cursor.as_deref() {
			set_query_pair(&mut page_url, "after_id", value);
		}
		let response = request_model_page(
			client,
			InferenceProviderFormat::Anthropic,
			page_url,
			api_key,
		)
		.await?;
		let has_more = response.has_more;
		let next_cursor = response
			.last_id
			.as_deref()
			.map(str::trim)
			.filter(|value| !value.is_empty())
			.map(str::to_string);
		append_models(&mut models, response.data)?;

		if !has_more {
			sort_and_deduplicate(&mut models);
			return Ok(models);
		}

		let next_cursor =
			next_cursor.ok_or(ModelDiscoveryError::MissingPaginationCursor)?;
		if next_cursor.len() > MAX_MODEL_ID_BYTES {
			return Err(ModelDiscoveryError::ModelIdTooLong {
				limit: MAX_MODEL_ID_BYTES,
			});
		}
		if !seen_cursors.insert(next_cursor.clone()) {
			return Err(ModelDiscoveryError::RepeatedPaginationCursor);
		}
		cursor = Some(next_cursor);
	}

	Err(ModelDiscoveryError::TooManyPages {
		limit: MAX_ANTHROPIC_PAGES,
	})
}

async fn request_model_page(
	client: &Client,
	format: InferenceProviderFormat,
	url: Url,
	api_key: &str,
) -> Result<ModelListResponse, ModelDiscoveryError> {
	let request = match format {
		InferenceProviderFormat::Anthropic => client
			.get(url)
			.header("x-api-key", api_key)
			.header("anthropic-version", "2023-06-01"),
		InferenceProviderFormat::OpenAiCompletions
		| InferenceProviderFormat::OpenAiResponses => {
			client.get(url).bearer_auth(api_key)
		}
	};
	let response = request
		.send()
		.await
		.map_err(|error| ModelDiscoveryError::Request(error.without_url()))?;
	let status = response.status();
	if !status.is_success() {
		return Err(ModelDiscoveryError::UpstreamStatus(status));
	}
	let body = read_limited_response(response).await?;
	serde_json::from_slice(&body).map_err(ModelDiscoveryError::InvalidResponse)
}

async fn read_limited_response(
	mut response: reqwest::Response,
) -> Result<Vec<u8>, ModelDiscoveryError> {
	if response
		.content_length()
		.is_some_and(|length| length > MAX_MODEL_RESPONSE_BYTES as u64)
	{
		return Err(ModelDiscoveryError::ResponseTooLarge {
			limit: MAX_MODEL_RESPONSE_BYTES,
		});
	}

	let mut body = Vec::new();
	while let Some(chunk) = response.chunk().await.map_err(|error| {
		ModelDiscoveryError::ReadResponse(error.without_url())
	})? {
		if body.len().saturating_add(chunk.len()) > MAX_MODEL_RESPONSE_BYTES {
			return Err(ModelDiscoveryError::ResponseTooLarge {
				limit: MAX_MODEL_RESPONSE_BYTES,
			});
		}
		body.extend_from_slice(&chunk);
	}
	Ok(body)
}

fn append_models(
	models: &mut Vec<String>,
	items: Vec<ModelListItem>,
) -> Result<(), ModelDiscoveryError> {
	if models.len().saturating_add(items.len()) > MAX_DISCOVERED_MODELS {
		return Err(ModelDiscoveryError::TooManyModels {
			limit: MAX_DISCOVERED_MODELS,
		});
	}
	for item in items {
		let id = item.id.trim();
		if id.len() > MAX_MODEL_ID_BYTES {
			return Err(ModelDiscoveryError::ModelIdTooLong {
				limit: MAX_MODEL_ID_BYTES,
			});
		}
		if !id.is_empty() {
			models.push(id.to_string());
		}
	}
	Ok(())
}

fn sort_and_deduplicate(models: &mut Vec<String>) {
	models.sort_by(|left, right| {
		left.to_ascii_lowercase()
			.cmp(&right.to_ascii_lowercase())
			.then_with(|| left.cmp(right))
	});
	models.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
}

fn set_query_pair(url: &mut Url, key: &str, value: &str) {
	let pairs = url
		.query_pairs()
		.filter(|(existing, _)| existing != key)
		.map(|(key, value)| (key.into_owned(), value.into_owned()))
		.collect::<Vec<_>>();
	url.set_query(None);
	let mut query = url.query_pairs_mut();
	for (key, value) in pairs {
		query.append_pair(&key, &value);
	}
	query.append_pair(key, value);
}

fn remove_query_pair(url: &mut Url, key: &str) {
	let pairs = url
		.query_pairs()
		.filter(|(existing, _)| existing != key)
		.map(|(key, value)| (key.into_owned(), value.into_owned()))
		.collect::<Vec<_>>();
	url.set_query(None);
	let mut query = url.query_pairs_mut();
	for (key, value) in pairs {
		query.append_pair(&key, &value);
	}
}

#[cfg(test)]
mod tests;

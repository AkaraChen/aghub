use std::time::Duration;

use reqwest::{Client as HttpClient, Url};

use crate::types::{map_detail, McpCatalogEntry, ServerListResponse};

const DEFAULT_API_URL: &str = "https://registry.modelcontextprotocol.io/";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Official MCP Registry client.
#[derive(Debug, Clone)]
pub struct Client {
	http: HttpClient,
	base_url: Url,
}

/// Client builder.
#[derive(Debug)]
pub struct ClientBuilder {
	api_url: Option<String>,
	timeout: Duration,
}

impl Default for ClientBuilder {
	fn default() -> Self {
		Self {
			api_url: None,
			timeout: DEFAULT_TIMEOUT,
		}
	}
}

impl ClientBuilder {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn api_url(mut self, url: impl Into<String>) -> Self {
		self.api_url = Some(url.into());
		self
	}

	pub fn timeout(mut self, timeout: Duration) -> Self {
		self.timeout = timeout;
		self
	}

	pub fn build(self) -> Result<Client, ClientError> {
		let base_url = self
			.api_url
			.as_deref()
			.unwrap_or(DEFAULT_API_URL)
			.parse::<Url>()?;
		let http = HttpClient::builder().timeout(self.timeout).build()?;
		Ok(Client { http, base_url })
	}
}

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
	#[error("HTTP request failed: {0}")]
	Http(#[from] reqwest::Error),
	#[error("invalid registry URL: {0}")]
	Url(#[from] url::ParseError),
	#[error("registry returned {status}: {message}")]
	Api { status: u16, message: String },
}

impl Client {
	/// Create a client with default configuration.
	pub fn new() -> Result<Self, ClientError> {
		ClientBuilder::new().build()
	}

	/// Create a client honoring the `MCP_REGISTRY_URL` environment override.
	pub fn from_env() -> Result<Self, ClientError> {
		let mut builder = ClientBuilder::new();
		if let Some(url) = std::env::var("MCP_REGISTRY_URL")
			.ok()
			.filter(|value| !value.trim().is_empty())
		{
			builder = builder.api_url(url);
		}
		builder.build()
	}

	/// Search the registry. An empty `query` returns the latest servers.
	pub async fn search(
		&self,
		query: &str,
		limit: usize,
	) -> Result<Vec<McpCatalogEntry>, ClientError> {
		let mut url = self.base_url.join("v0/servers")?;
		{
			let mut pairs = url.query_pairs_mut();
			pairs.append_pair("version", "latest");
			pairs.append_pair("limit", &limit.to_string());
			let trimmed = query.trim();
			if !trimmed.is_empty() {
				pairs.append_pair("search", trimmed);
			}
		}

		let response = self.http.get(url).send().await?;
		if !response.status().is_success() {
			let status = response.status().as_u16();
			let message = response.text().await.unwrap_or_default();
			return Err(ClientError::Api { status, message });
		}

		let body: ServerListResponse = response.json().await?;
		Ok(body
			.servers
			.into_iter()
			.filter_map(|envelope| map_detail(envelope.server))
			.collect())
	}
}

impl Default for Client {
	fn default() -> Self {
		Self::new().expect("failed to create default MCP registry client")
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn builder_defaults_to_official_registry() {
		let client = ClientBuilder::new().build().unwrap();
		assert_eq!(
			client.base_url.as_str(),
			"https://registry.modelcontextprotocol.io/"
		);
	}

	#[test]
	fn builder_accepts_custom_api_url() {
		let client = ClientBuilder::new()
			.api_url("https://example.test/")
			.build()
			.unwrap();
		assert_eq!(client.base_url.as_str(), "https://example.test/");
	}

	#[test]
	fn builder_rejects_invalid_url() {
		let result = ClientBuilder::new().api_url("not a url").build();
		assert!(matches!(result, Err(ClientError::Url(_))));
	}
}

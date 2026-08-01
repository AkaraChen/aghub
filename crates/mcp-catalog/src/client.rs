use std::{sync::LazyLock, time::Duration};

use reqwest::{Client as HttpClient, Url};

use crate::{
	model::McpCatalogEntry,
	network::{build_http_client, validate_registry_url},
	normalize::map_detail,
	registry::ServerListResponse,
};

const DEFAULT_API_URL: &str = "https://registry.modelcontextprotocol.io/";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const SERVERS_PATH: &str = "v0.1/servers";
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_ERROR_BYTES: usize = 2048;

static DEFAULT_HTTP_CLIENT: LazyLock<Result<HttpClient, String>> =
	LazyLock::new(|| {
		build_http_client(DEFAULT_TIMEOUT).map_err(|error| error.to_string())
	});

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
		let mut base_url = self
			.api_url
			.as_deref()
			.unwrap_or(DEFAULT_API_URL)
			.parse::<Url>()?;
		validate_registry_url(&base_url)
			.map_err(|error| ClientError::UnsafeUrl(error.to_string()))?;
		// Ensure a trailing slash so `join(SERVERS_PATH)` keeps any path prefix
		// (e.g. a custom registry mounted under `/mcp-registry`).
		if !base_url.path().ends_with('/') {
			let path = format!("{}/", base_url.path());
			base_url.set_path(&path);
		}
		let http = if self.timeout == DEFAULT_TIMEOUT {
			DEFAULT_HTTP_CLIENT
				.as_ref()
				.map(Clone::clone)
				.map_err(|message| ClientError::HttpClient(message.clone()))?
		} else {
			build_http_client(self.timeout)?
		};
		Ok(Client { http, base_url })
	}
}

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
	#[error("HTTP request failed: {0}")]
	Http(#[from] reqwest::Error),
	#[error("invalid registry URL: {0}")]
	Url(#[from] url::ParseError),
	#[error("unsafe registry URL: {0}")]
	UnsafeUrl(String),
	#[error("failed to create HTTP client: {0}")]
	HttpClient(String),
	#[error("invalid registry response: {0}")]
	Json(#[from] serde_json::Error),
	#[error("registry response exceeds {MAX_RESPONSE_BYTES} bytes")]
	ResponseTooLarge,
	#[error("registry returned {status}: {message}")]
	Api { status: u16, message: String },
}

impl Client {
	/// Create a client with default configuration.
	pub fn new() -> Result<Self, ClientError> {
		ClientBuilder::new().build()
	}

	/// Normalized registry base URL used by this client.
	pub fn registry_url(&self) -> &str {
		self.base_url.as_str()
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
		let mut url = self.base_url.join(SERVERS_PATH)?;
		{
			let mut pairs = url.query_pairs_mut();
			pairs.append_pair("version", "latest");
			pairs.append_pair("limit", &limit.to_string());
			let trimmed = query.trim();
			if !trimmed.is_empty() {
				pairs.append_pair("search", trimmed);
			}
		}

		let mut response = self.http.get(url).send().await?;
		if !response.status().is_success() {
			let status = response.status().as_u16();
			let body = read_body(&mut response, MAX_ERROR_BYTES).await?;
			let message = String::from_utf8_lossy(&body).into_owned();
			return Err(ClientError::Api { status, message });
		}

		let body = read_body(&mut response, MAX_RESPONSE_BYTES).await?;
		let body: ServerListResponse = serde_json::from_slice(&body)?;
		Ok(body
			.servers
			.into_iter()
			.filter_map(|entry| map_detail(entry.server))
			.collect())
	}
}

async fn read_body(
	response: &mut reqwest::Response,
	limit: usize,
) -> Result<Vec<u8>, ClientError> {
	let mut body = Vec::new();
	while let Some(chunk) = response.chunk().await? {
		if body.len().saturating_add(chunk.len()) > limit {
			return Err(ClientError::ResponseTooLarge);
		}
		body.extend_from_slice(&chunk);
	}
	Ok(body)
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
	fn builder_normalizes_missing_trailing_slash() {
		let client = ClientBuilder::new()
			.api_url("https://corp.example/mcp-registry")
			.build()
			.unwrap();
		assert_eq!(
			client.base_url.as_str(),
			"https://corp.example/mcp-registry/"
		);
		let search = client.base_url.join(SERVERS_PATH).unwrap();
		assert_eq!(
			search.as_str(),
			"https://corp.example/mcp-registry/v0.1/servers"
		);
	}

	#[test]
	fn builder_rejects_invalid_url() {
		let result = ClientBuilder::new().api_url("not a url").build();
		assert!(matches!(result, Err(ClientError::Url(_))));
	}

	#[test]
	fn builder_rejects_non_http_registry_url() {
		let result =
			ClientBuilder::new().api_url("file:///tmp/registry").build();
		assert!(matches!(result, Err(ClientError::UnsafeUrl(_))));
	}

	#[test]
	fn builder_rejects_registry_url_with_credentials() {
		let result = ClientBuilder::new()
			.api_url("https://user:secret@example.test")
			.build();
		assert!(matches!(result, Err(ClientError::UnsafeUrl(_))));
	}

	#[test]
	fn builder_rejects_private_registry_targets() {
		for url in [
			"http://localhost:8080",
			"http://localhost.:8080",
			"http://127.0.0.1:8080",
			"http://169.254.169.254/latest/meta-data",
			"http://10.0.0.1",
			"http://[::1]",
			"http://[::ffff:127.0.0.1]",
			"http://[64:ff9b::7f00:1]",
			"http://[2002:7f00:1::]",
			"http://[fec0::1]",
			"http://[3fff::1]",
		] {
			let result = ClientBuilder::new().api_url(url).build();
			assert!(
				matches!(result, Err(ClientError::UnsafeUrl(_))),
				"accepted unsafe URL: {url}",
			);
		}
	}

	#[test]
	fn direct_transparent_proxy_address_remains_unsafe() {
		let result =
			ClientBuilder::new().api_url("https://198.18.12.78").build();
		assert!(matches!(result, Err(ClientError::UnsafeUrl(_))));
	}
}

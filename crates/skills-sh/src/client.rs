use crate::types::{SearchParams, SearchResponse, SearchResult};
use reqwest::{Client as HttpClient, Url};
use std::time::Duration;

const DEFAULT_API_URL: &str = "https://skills.sh/api/";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// skills.sh API client
#[derive(Debug, Clone)]
pub struct Client {
	http: HttpClient,
	base_url: Url,
}

/// Client builder
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
	#[error("Invalid URL: {0}")]
	Url(#[from] url::ParseError),
	#[error("API error: {status} - {message}")]
	Api { status: u16, message: String },
}

impl Client {
	/// Create client with default configuration
	pub fn new() -> Result<Self, ClientError> {
		ClientBuilder::new().build()
	}

	/// Create client from SKILLS_API_URL environment variable
	pub fn from_env() -> Result<Self, ClientError> {
		let api_url = std::env::var("SKILLS_API_URL").ok();
		let mut builder = ClientBuilder::new();
		if let Some(url) = api_url {
			builder = builder.api_url(url);
		}
		builder.build()
	}

	/// Search for skills
	pub async fn search(
		&self,
		params: &SearchParams,
	) -> Result<Vec<SearchResult>, ClientError> {
		let mut url = self.base_url.join("search")?;
		url.query_pairs_mut().append_pair("q", &params.query);

		if let Some(limit) = params.limit {
			url.query_pairs_mut()
				.append_pair("limit", &limit.to_string());
		}

		let response = self.http.get(url).send().await?;

		if !response.status().is_success() {
			let status = response.status().as_u16();
			let message = response.text().await.unwrap_or_default();
			return Err(ClientError::Api { status, message });
		}

		let search_response: SearchResponse = response.json().await?;

		// Sort by installs descending (consistent with find.ts)
		let mut results: Vec<SearchResult> = search_response
			.skills
			.into_iter()
			.map(SearchResult::from)
			.collect();

		results.sort_by_key(|b| std::cmp::Reverse(b.installs));

		Ok(results)
	}

	/// Convenience method: search with string query
	pub async fn find(
		&self,
		query: impl AsRef<str>,
	) -> Result<Vec<SearchResult>, ClientError> {
		self.search(&SearchParams::new(query.as_ref())).await
	}
}

impl Default for Client {
	fn default() -> Self {
		Self::new().expect("Failed to create default client")
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_client_builder_default() {
		let builder = ClientBuilder::new();
		assert!(builder.api_url.is_none());
		assert_eq!(builder.timeout, DEFAULT_TIMEOUT);
	}

	#[test]
	fn test_client_builder_with_api_url() {
		let client = ClientBuilder::new()
			.api_url("https://custom.api.com/api")
			.build()
			.unwrap();

		assert_eq!(client.base_url.as_str(), "https://custom.api.com/api");
	}

	#[test]
	fn test_client_builder_with_timeout() {
		let client = ClientBuilder::new()
			.timeout(Duration::from_secs(10))
			.build()
			.unwrap();

		// Timeout is internal to reqwest, we just verify it builds
		assert_eq!(client.base_url.as_str(), "https://skills.sh/api/");
	}

	#[test]
	fn test_client_new() {
		let client = Client::new().unwrap();
		// reqwest's Url adds trailing slash to the path
		assert!(client
			.base_url
			.as_str()
			.starts_with("https://skills.sh/api"));
	}

	#[test]
	fn test_client_builder_invalid_url() {
		let result = ClientBuilder::new().api_url("not a valid url").build();
		assert!(matches!(result, Err(ClientError::Url(_))));
	}

	#[test]
	fn test_client_error_display() {
		let url_error = "invalid".parse::<Url>().unwrap_err();
		let error = ClientError::Url(url_error);
		assert!(format!("{}", error).contains("Invalid URL"));
	}

	#[test]
	fn test_client_error_api_display() {
		let error = ClientError::Api {
			status: 404,
			message: "Not found".to_string(),
		};
		assert_eq!(format!("{}", error), "API error: 404 - Not found");
	}
}

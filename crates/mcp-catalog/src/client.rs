use std::{
	io,
	net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
	sync::LazyLock,
	time::Duration,
};

use reqwest::{
	dns::{Addrs, Name, Resolve, Resolving},
	redirect::Policy,
	Client as HttpClient, Url,
};

use crate::{
	model::McpCatalogEntry, normalize::map_detail, registry::ServerListResponse,
};

const DEFAULT_API_URL: &str = "https://registry.modelcontextprotocol.io/";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const SERVERS_PATH: &str = "v0.1/servers";
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_ERROR_BYTES: usize = 2048;
const TRANSPARENT_PROXY_IPV4_RANGE: (Ipv4Addr, u32) =
	(Ipv4Addr::new(198, 18, 0, 0), 15);

// IANA special-purpose ranges and transition prefixes that can encode a
// non-public IPv4 destination.
const NON_PUBLIC_IPV4_RANGES: &[(Ipv4Addr, u32)] = &[
	(Ipv4Addr::new(0, 0, 0, 0), 8),
	(Ipv4Addr::new(10, 0, 0, 0), 8),
	(Ipv4Addr::new(100, 64, 0, 0), 10),
	(Ipv4Addr::new(127, 0, 0, 0), 8),
	(Ipv4Addr::new(169, 254, 0, 0), 16),
	(Ipv4Addr::new(172, 16, 0, 0), 12),
	(Ipv4Addr::new(192, 0, 0, 0), 24),
	(Ipv4Addr::new(192, 0, 2, 0), 24),
	(Ipv4Addr::new(192, 88, 99, 0), 24),
	(Ipv4Addr::new(192, 168, 0, 0), 16),
	(Ipv4Addr::new(198, 18, 0, 0), 15),
	(Ipv4Addr::new(198, 51, 100, 0), 24),
	(Ipv4Addr::new(203, 0, 113, 0), 24),
	(Ipv4Addr::new(224, 0, 0, 0), 4),
	(Ipv4Addr::new(240, 0, 0, 0), 4),
];
const NON_PUBLIC_IPV6_RANGES: &[(Ipv6Addr, u32)] = &[
	(Ipv6Addr::UNSPECIFIED, 96),
	(Ipv6Addr::new(0x64, 0xff9b, 0, 0, 0, 0, 0, 0), 96),
	(Ipv6Addr::new(0x64, 0xff9b, 1, 0, 0, 0, 0, 0), 48),
	(Ipv6Addr::new(0x100, 0, 0, 0, 0, 0, 0, 0), 64),
	(Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 0), 23),
	(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), 32),
	(Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16),
	(Ipv6Addr::new(0x3fff, 0, 0, 0, 0, 0, 0, 0), 20),
	(Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 0), 7),
	(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 0), 10),
	(Ipv6Addr::new(0xfec0, 0, 0, 0, 0, 0, 0, 0), 10),
	(Ipv6Addr::new(0xff00, 0, 0, 0, 0, 0, 0, 0), 8),
];

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
		validate_registry_url(&base_url)?;
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

#[derive(Debug)]
struct PublicDnsResolver;

impl Resolve for PublicDnsResolver {
	fn resolve(&self, name: Name) -> Resolving {
		let host = name.as_str().to_string();
		Box::pin(async move {
			let addresses: Vec<SocketAddr> =
				tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
			if addresses.is_empty() {
				return Err(Box::new(io::Error::new(
					io::ErrorKind::NotFound,
					format!("registry host did not resolve: {host}"),
				)) as _);
			}
			if addresses
				.iter()
				.any(|address| !is_safe_resolved_ip(address.ip()))
			{
				return Err(Box::new(io::Error::new(
					io::ErrorKind::PermissionDenied,
					format!(
						"registry host resolved to a private address: {host}"
					),
				)) as _);
			}
			Ok(Box::new(addresses.into_iter()) as Addrs)
		})
	}
}

fn build_http_client(timeout: Duration) -> Result<HttpClient, reqwest::Error> {
	HttpClient::builder()
		.timeout(timeout)
		.redirect(Policy::none())
		.no_proxy()
		.dns_resolver(PublicDnsResolver)
		.build()
}

fn validate_registry_url(url: &Url) -> Result<(), ClientError> {
	if !matches!(url.scheme(), "http" | "https") {
		return Err(ClientError::UnsafeUrl(
			"scheme must be http or https".to_string(),
		));
	}
	if !url.username().is_empty() || url.password().is_some() {
		return Err(ClientError::UnsafeUrl(
			"credentials are not allowed".to_string(),
		));
	}
	let host = url.host().ok_or_else(|| {
		ClientError::UnsafeUrl("host is required".to_string())
	})?;
	match host {
		url::Host::Domain(domain) => {
			let normalized = domain.trim_end_matches('.');
			if normalized.eq_ignore_ascii_case("localhost")
				|| normalized.to_ascii_lowercase().ends_with(".localhost")
			{
				return Err(ClientError::UnsafeUrl(
					"localhost is not allowed".to_string(),
				));
			}
		}
		url::Host::Ipv4(address) => ensure_public_ip(IpAddr::V4(address))?,
		url::Host::Ipv6(address) => ensure_public_ip(IpAddr::V6(address))?,
	}
	Ok(())
}

fn ensure_public_ip(address: IpAddr) -> Result<(), ClientError> {
	if is_public_ip(address) {
		Ok(())
	} else {
		Err(ClientError::UnsafeUrl(
			"private network targets are not allowed".to_string(),
		))
	}
}

fn is_public_ip(address: IpAddr) -> bool {
	match address {
		IpAddr::V4(address) => is_public_ipv4(address),
		IpAddr::V6(address) => is_public_ipv6(address),
	}
}

fn is_safe_resolved_ip(address: IpAddr) -> bool {
	is_public_ip(address) || is_transparent_proxy_ipv4(address)
}

// Transparent proxies on macOS can map public DNS names into the RFC 2544
// benchmark range. This exception is only used after domain resolution;
// literal URLs in the same range still fail `validate_registry_url`.
fn is_transparent_proxy_ipv4(address: IpAddr) -> bool {
	let IpAddr::V4(address) = address else {
		return false;
	};
	let (network, prefix) = TRANSPARENT_PROXY_IPV4_RANGE;
	let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
	u32::from(address) & mask == u32::from(network) & mask
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
	let value = u32::from(address);
	let in_range = |network: Ipv4Addr, prefix: u32| {
		let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
		value & mask == u32::from(network) & mask
	};
	!NON_PUBLIC_IPV4_RANGES
		.iter()
		.any(|&(network, prefix)| in_range(network, prefix))
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
	if let Some(mapped) = address.to_ipv4_mapped() {
		return is_public_ipv4(mapped);
	}
	let value = u128::from(address);
	let in_range = |network: Ipv6Addr, prefix: u32| {
		let mask = u128::MAX.checked_shl(128 - prefix).unwrap_or(0);
		value & mask == u128::from(network) & mask
	};
	!NON_PUBLIC_IPV6_RANGES
		.iter()
		.any(|&(network, prefix)| in_range(network, prefix))
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
	fn domain_resolution_accepts_transparent_proxy_address() {
		assert!(is_safe_resolved_ip(IpAddr::V4(Ipv4Addr::new(
			198, 18, 12, 78,
		))));
	}

	#[test]
	fn direct_transparent_proxy_address_remains_unsafe() {
		let result =
			ClientBuilder::new().api_url("https://198.18.12.78").build();
		assert!(matches!(result, Err(ClientError::UnsafeUrl(_))));
	}

	#[test]
	fn domain_resolution_still_rejects_private_address() {
		assert!(!is_safe_resolved_ip(IpAddr::V4(Ipv4Addr::new(
			192, 168, 1, 10,
		))));
	}
}

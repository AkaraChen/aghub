use mcp_catalog::{Client, ClientBuilder, ClientError};
use rocket::http::Status;
use rocket::serde::json::Json;

use crate::auth::ApiAuth;
use crate::dto::mcp_market::MarketMcpServer;
use crate::error::ApiError;

const DEFAULT_LIMIT: usize = 60;
const MAX_LIMIT: usize = 100;

fn custom_registry_client(url: &str) -> Result<Client, ApiError> {
	ClientBuilder::new()
		.api_url(url)
		.build()
		.map_err(|error| match error {
			ClientError::Url(_) | ClientError::UnsafeUrl(_) => ApiError::new(
				Status::BadRequest,
				error.to_string(),
				"MCP_MARKET_INVALID_SOURCE",
			),
			_ => ApiError::new(
				Status::InternalServerError,
				error.to_string(),
				"MCP_MARKET_CLIENT_ERROR",
			),
		})
}

/// Search an MCP registry. Defaults to the official registry; `registry_url`
/// points at a public registry that implements the same API. An empty `q`
/// returns the latest servers.
#[get("/mcp-market/search?<q>&<limit>&<registry_url>")]
pub async fn search_mcp_market(
	_auth: ApiAuth,
	q: Option<&str>,
	limit: Option<usize>,
	registry_url: Option<&str>,
) -> Result<Json<Vec<MarketMcpServer>>, ApiError> {
	let custom = registry_url.map(str::trim).filter(|url| !url.is_empty());
	let client = match custom {
		Some(url) => custom_registry_client(url)?,
		None => Client::from_env().map_err(|error| {
			ApiError::new(
				Status::InternalServerError,
				error.to_string(),
				"MCP_MARKET_CLIENT_ERROR",
			)
		})?,
	};

	let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

	let entries = client.search(q.unwrap_or(""), limit).await.map_err(|e| {
		ApiError::new(
			Status::BadGateway,
			e.to_string(),
			"MCP_MARKET_SEARCH_ERROR",
		)
	})?;
	let catalog_url = client.registry_url().to_string();

	Ok(Json(
		entries
			.into_iter()
			.map(|entry| {
				MarketMcpServer::from_catalog(entry, catalog_url.clone())
			})
			.collect(),
	))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn invalid_custom_registry_is_a_client_error() {
		let error = custom_registry_client("file:///tmp/registry").unwrap_err();

		assert_eq!(error.status, Status::BadRequest);
		assert_eq!(error.body.code, "MCP_MARKET_INVALID_SOURCE");
	}

	#[test]
	fn private_custom_registry_is_a_client_error() {
		let error = custom_registry_client("http://127.0.0.1").unwrap_err();

		assert_eq!(error.status, Status::BadRequest);
		assert_eq!(error.body.code, "MCP_MARKET_INVALID_SOURCE");
	}
}

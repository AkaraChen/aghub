use mcp_catalog::Client;
use rocket::http::Status;
use rocket::serde::json::Json;

use crate::auth::ApiAuth;
use crate::dto::mcp_market::MarketMcpServer;
use crate::error::ApiError;

const DEFAULT_LIMIT: usize = 60;
const MAX_LIMIT: usize = 100;

/// Search the official MCP registry. An empty `q` returns the latest servers.
#[get("/mcp-market/search?<q>&<limit>")]
pub async fn search_mcp_market(
	_auth: ApiAuth,
	q: Option<&str>,
	limit: Option<usize>,
) -> Result<Json<Vec<MarketMcpServer>>, ApiError> {
	let client = Client::from_env().map_err(|e| {
		ApiError::new(
			Status::InternalServerError,
			e.to_string(),
			"MCP_MARKET_CLIENT_ERROR",
		)
	})?;

	let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

	let entries = client.search(q.unwrap_or(""), limit).await.map_err(|e| {
		ApiError::new(
			Status::BadGateway,
			e.to_string(),
			"MCP_MARKET_SEARCH_ERROR",
		)
	})?;

	Ok(Json(
		entries.into_iter().map(MarketMcpServer::from).collect(),
	))
}

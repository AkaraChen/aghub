use rocket::http::Status;
use rocket::serde::json::Json;
use skills_sh::{Client, SearchParams};

use crate::dto::market::MarketSkill;
use crate::error::ApiError;

/// Search skills from marketplace
/// `source` defaults to "skills-sh", extensible for future providers
#[get("/skills-market/search?<q>&<limit>&<source>")]
pub async fn search_skill_market(
	q: &str,
	limit: Option<usize>,
	source: Option<&str>,
) -> Result<Json<Vec<MarketSkill>>, ApiError> {
	let provider = source.unwrap_or("skills-sh");

	match provider {
		"skills-sh" => search_skills_sh(q, limit).await,
		_ => Err(ApiError::new(
			Status::BadRequest,
			format!("unknown market source: {provider}"),
			"UNKNOWN_MARKET_SOURCE",
		)),
	}
}

async fn search_skills_sh(
	q: &str,
	limit: Option<usize>,
) -> Result<Json<Vec<MarketSkill>>, ApiError> {
	let client = Client::new().map_err(|e| {
		ApiError::new(
			Status::InternalServerError,
			e.to_string(),
			"MARKET_CLIENT_ERROR",
		)
	})?;

	let mut params = SearchParams::new(q);
	if let Some(l) = limit {
		params = params.with_limit(l);
	}

	let results = client.search(&params).await.map_err(|e| {
		ApiError::new(Status::BadGateway, e.to_string(), "MARKET_SEARCH_ERROR")
	})?;

	Ok(Json(
		results
			.into_iter()
			.map(|r| {
				// Parse author safely from "github/author" or "github/author/repo"
				let author = if r.source.starts_with("github/") {
					r.source.split('/').nth(1).map(String::from)
				} else {
					None
				};
				MarketSkill {
					name: r.name,
					slug: r.slug,
					source: r.source,
					installs: r.installs,
					author,
				}
			})
			.collect(),
	))
}

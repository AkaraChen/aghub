use std::path::PathBuf;

use aghub_api::{start, ApiOptions};

/// Standalone server entry. `AGHUB_API_PORT` and `AGHUB_CCUSAGE_BIN` override
/// the defaults (the auth token already comes from `AGHUB_API_TOKEN` inside
/// `ApiOptions::resolve`), which lets the desktop e2e suite boot this binary
/// against a fixture ccusage.
#[tokio::main]
async fn main() {
	let port = std::env::var("AGHUB_API_PORT")
		.ok()
		.and_then(|value| value.parse().ok())
		.unwrap_or(8000);
	let mut options = ApiOptions::new(port);
	if let Some(bin) = std::env::var("AGHUB_CCUSAGE_BIN")
		.ok()
		.filter(|value| !value.trim().is_empty())
	{
		options.ccusage_bin = Some(PathBuf::from(bin));
	}
	start(options).await.expect("server error");
}

// e2e-only runner: serves aghub-api on a fixed free port and allows the
// e2e vite origin. Not part of the shipped surface; run via
// `AGHUB_API_TOKEN=e2e-test-token cargo run -p aghub-api --example e2e_server`.
use aghub_api::{start, ApiOptions};

#[tokio::main]
async fn main() {
	let mut options = ApiOptions::new(18001);
	options
		.allowed_origins
		.push("http://localhost:14321".to_string());
	start(options).await.expect("server error");
}

use aghub_api::{start, ApiOptions};

#[tokio::main]
async fn main() {
	start(ApiOptions::new(8000)).await.expect("server error");
}

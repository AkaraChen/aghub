#[tokio::main]
async fn main() {
    aghub_api::start(8000).await.expect("server error");
}

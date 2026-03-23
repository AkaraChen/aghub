use skills_sh::{Client, ClientBuilder, SearchParams};
use std::time::Duration;

#[test]
fn test_client_creation() {
	let client = Client::new();
	assert!(client.is_ok());
}

#[test]
fn test_client_builder_chain() {
	let client = ClientBuilder::new()
		.api_url("https://api.example.com/v1")
		.timeout(Duration::from_secs(5))
		.build();

	assert!(client.is_ok());
}

#[test]
fn test_client_builder_default_url() {
	let _client = ClientBuilder::new().build().unwrap();
	// Note: reqwest's Url adds trailing slash
	// Can't directly access base_url here since it's private
	// This test ensures it builds successfully with defaults
}

#[tokio::test]
async fn test_search_params_builder() {
	let params = SearchParams::new("git").with_limit(10);
	assert_eq!(params.query, "git");
	assert_eq!(params.limit, Some(10));
}

#[tokio::test]
async fn test_find_convenience_method() {
	let client = Client::new().unwrap();
	// We can't test actual API call without mocking
	// This just verifies the method signature works
	let _ = client.find("test").await;
}

#[test]
fn test_client_from_env_without_var() {
	// Ensure SKILLS_API_URL is not set
	std::env::remove_var("SKILLS_API_URL");

	let client = Client::from_env();
	assert!(client.is_ok());
}

#[test]
fn test_client_from_env_with_var() {
	std::env::set_var("SKILLS_API_URL", "https://custom.skills.sh/api");

	let client = Client::from_env();
	assert!(client.is_ok());

	// Clean up
	std::env::remove_var("SKILLS_API_URL");
}

#[tokio::test]
#[ignore = "Flaky remote API test"]
async fn test_live_search() {
	let client = Client::new().unwrap();
	let results = client.find("github").await.unwrap();
	assert!(!results.is_empty());
	let first = &results[0];
	assert!(!first.name.is_empty());
	assert!(!first.slug.is_empty());
	assert!(first.installs > 0);
}

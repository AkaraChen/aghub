use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use crate::provider_endpoint::{
	model_list_url, provider_credential_scope_matches, ProviderEndpointError,
};
use crate::InferenceProvider;

use super::*;

struct TestResponse {
	status: &'static str,
	headers: Vec<(String, String)>,
	body: String,
	include_content_length: bool,
}

impl TestResponse {
	fn json(body: impl Into<String>) -> Self {
		Self {
			status: "200 OK",
			headers: vec![(
				"Content-Type".to_string(),
				"application/json".to_string(),
			)],
			body: body.into(),
			include_content_length: true,
		}
	}
}

#[derive(Debug)]
struct CapturedRequest {
	target: String,
	headers: BTreeMap<String, String>,
}

fn spawn_server(
	responses: Vec<TestResponse>,
) -> (String, Receiver<Vec<CapturedRequest>>) {
	let listener = TcpListener::bind("127.0.0.1:0").unwrap();
	let address = listener.local_addr().unwrap();
	let (sender, receiver) = mpsc::channel();
	thread::spawn(move || {
		let mut requests = Vec::new();
		for response in responses {
			let (mut stream, _) = listener.accept().unwrap();
			requests.push(read_request(&mut stream));
			write_response(&mut stream, response);
		}
		sender.send(requests).unwrap();
	});
	(format!("http://{address}"), receiver)
}

fn spawn_probe_server() -> (String, Receiver<Option<CapturedRequest>>) {
	let listener = TcpListener::bind("127.0.0.1:0").unwrap();
	listener.set_nonblocking(true).unwrap();
	let address = listener.local_addr().unwrap();
	let (sender, receiver) = mpsc::channel();
	thread::spawn(move || {
		let deadline = Instant::now() + Duration::from_secs(1);
		while Instant::now() < deadline {
			match listener.accept() {
				Ok((mut stream, _)) => {
					let request = read_request(&mut stream);
					write_response(
						&mut stream,
						TestResponse::json(r#"{"data":[]}"#),
					);
					sender.send(Some(request)).unwrap();
					return;
				}
				Err(error)
					if error.kind() == std::io::ErrorKind::WouldBlock =>
				{
					thread::sleep(Duration::from_millis(10));
				}
				Err(error) => panic!("probe server failed: {error}"),
			}
		}
		sender.send(None).unwrap();
	});
	(format!("http://{address}"), receiver)
}

fn read_request(stream: &mut TcpStream) -> CapturedRequest {
	stream
		.set_read_timeout(Some(Duration::from_secs(2)))
		.unwrap();
	let mut bytes = Vec::new();
	let mut buffer = [0_u8; 1024];
	while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
		let read = stream.read(&mut buffer).unwrap();
		if read == 0 {
			break;
		}
		bytes.extend_from_slice(&buffer[..read]);
	}
	let text = String::from_utf8(bytes).unwrap();
	let mut lines = text.split("\r\n");
	let target = lines
		.next()
		.and_then(|line| line.split_whitespace().nth(1))
		.unwrap()
		.to_string();
	let headers = lines
		.filter_map(|line| line.split_once(':'))
		.map(|(name, value)| {
			(name.trim().to_ascii_lowercase(), value.trim().to_string())
		})
		.collect();
	CapturedRequest { target, headers }
}

fn write_response(stream: &mut TcpStream, response: TestResponse) {
	let mut head = format!("HTTP/1.1 {}\r\n", response.status);
	for (name, value) in response.headers {
		head.push_str(&format!("{name}: {value}\r\n"));
	}
	if response.include_content_length {
		head.push_str(&format!("Content-Length: {}\r\n", response.body.len()));
	}
	head.push_str("Connection: close\r\n\r\n");
	let _ = stream.write_all(head.as_bytes());
	let _ = stream.write_all(response.body.as_bytes());
}

fn request<'a>(
	format: InferenceProviderFormat,
	api_base_url: &'a str,
) -> ModelDiscoveryRequest<'a> {
	ModelDiscoveryRequest {
		format,
		api_base_url,
		api_key: "secret",
	}
}

#[test]
fn model_list_url_appends_v1_for_origin_only_base_url() {
	let url = model_list_url("https://api.example.com").unwrap();

	assert_eq!(url.as_str(), "https://api.example.com/v1/models");
}

#[test]
fn model_list_url_preserves_existing_api_path() {
	let url = model_list_url("https://api.example.com/coding/v1/").unwrap();

	assert_eq!(url.as_str(), "https://api.example.com/coding/v1/models");
}

#[test]
fn model_list_url_accepts_host_without_scheme() {
	let url = model_list_url("api.example.com/v1").unwrap();

	assert_eq!(url.as_str(), "https://api.example.com/v1/models");
}

#[test]
fn model_list_url_uses_https_for_non_local_hosts() {
	let url = model_list_url("localhost.example.com/v1").unwrap();

	assert_eq!(url.as_str(), "https://localhost.example.com/v1/models");
}

#[test]
fn model_list_url_uses_http_for_localhost_subdomains() {
	let url = model_list_url("models.localhost/v1").unwrap();

	assert_eq!(url.as_str(), "http://models.localhost/v1/models");
}

#[test]
fn model_list_url_replaces_request_endpoint_suffix() {
	let url =
		model_list_url("https://api.example.com/v1/chat/completions").unwrap();

	assert_eq!(url.as_str(), "https://api.example.com/v1/models");
}

#[test]
fn model_list_url_rejects_unsupported_endpoints() {
	for api_base_url in [
		"ftp://api.example.com/v1",
		"https://user:secret@api.example.com/v1",
	] {
		assert!(matches!(
			model_list_url(api_base_url),
			Err(ProviderEndpointError::Unsupported)
		));
	}
	assert!(matches!(
		model_list_url("://"),
		Err(ProviderEndpointError::Invalid)
	));
	assert!(matches!(
		model_list_url(" "),
		Err(ProviderEndpointError::Empty)
	));
}

#[test]
fn saved_api_key_is_reused_only_for_saved_endpoint_and_format() {
	let provider = InferenceProvider {
		id: "provider-id".to_string(),
		latin_name: "example".to_string(),
		display_name: "Example".to_string(),
		format: InferenceProviderFormat::OpenAiResponses,
		api_base_url: "https://api.example.com/v1/responses".to_string(),
		preset: None,
		masked_api_key: "••••".to_string(),
		models: Vec::new(),
	};

	assert!(provider_credential_scope_matches(
		&provider,
		InferenceProviderFormat::OpenAiResponses,
		"api.example.com/v1/",
	));
	assert!(!provider_credential_scope_matches(
		&provider,
		InferenceProviderFormat::OpenAiResponses,
		"https://other.example.com/v1",
	));
	assert!(!provider_credential_scope_matches(
		&provider,
		InferenceProviderFormat::OpenAiCompletions,
		"https://api.example.com/v1",
	));
	assert!(!provider_credential_scope_matches(
		&provider,
		InferenceProviderFormat::OpenAiResponses,
		"http://api.example.com/v1",
	));
}

#[tokio::test]
async fn response_models_are_sorted_and_deduplicated() {
	let (base_url, requests) = spawn_server(vec![TestResponse::json(
		r#"{"data":[{"id":"zeta"},{"id":"alpha"},{"id":"zeta"},{"id":"ALPHA"}]}"#,
	)]);

	let models = discover_models(request(
		InferenceProviderFormat::OpenAiResponses,
		&base_url,
	))
	.await
	.unwrap();

	assert_eq!(models, ["ALPHA", "zeta"]);
	let requests = requests.recv().unwrap();
	assert_eq!(
		requests[0].headers.get("authorization").map(String::as_str),
		Some("Bearer secret")
	);
}

#[tokio::test]
async fn anthropic_model_discovery_follows_bounded_pagination() {
	let (base_url, requests) = spawn_server(vec![
		TestResponse::json(
			r#"{"data":[{"id":"zeta"}],"has_more":true,"last_id":"zeta"}"#,
		),
		TestResponse::json(r#"{"data":[{"id":"alpha"}],"has_more":false}"#),
	]);
	let api_base_url = format!(
		"{base_url}?after_id=stale&before_id=other&limit=1&api-version=2026"
	);

	let models = discover_models(request(
		InferenceProviderFormat::Anthropic,
		&api_base_url,
	))
	.await
	.unwrap();

	assert_eq!(models, ["alpha", "zeta"]);
	let requests = requests.recv().unwrap();
	assert!(requests[0].target.contains("limit=1000"));
	assert!(!requests[0].target.contains("after_id"));
	assert!(!requests[0].target.contains("before_id"));
	assert!(requests[0].target.contains("api-version=2026"));
	assert!(requests[1].target.contains("after_id=zeta"));
	assert_eq!(
		requests[0].headers.get("x-api-key").map(String::as_str),
		Some("secret")
	);
}

#[tokio::test]
async fn anthropic_pagination_requires_a_cursor() {
	let (base_url, requests) = spawn_server(vec![TestResponse::json(
		r#"{"data":[],"has_more":true}"#,
	)]);

	let error =
		discover_models(request(InferenceProviderFormat::Anthropic, &base_url))
			.await
			.unwrap_err();

	assert!(matches!(
		error,
		ModelDiscoveryError::MissingPaginationCursor
	));
	requests.recv().unwrap();
}

#[tokio::test]
async fn anthropic_pagination_rejects_any_repeated_cursor() {
	let (base_url, requests) = spawn_server(vec![
		TestResponse::json(r#"{"data":[],"has_more":true,"last_id":"a"}"#),
		TestResponse::json(r#"{"data":[],"has_more":true,"last_id":"b"}"#),
		TestResponse::json(r#"{"data":[],"has_more":true,"last_id":"a"}"#),
	]);

	let error =
		discover_models(request(InferenceProviderFormat::Anthropic, &base_url))
			.await
			.unwrap_err();

	assert!(matches!(
		error,
		ModelDiscoveryError::RepeatedPaginationCursor
	));
	assert_eq!(requests.recv().unwrap().len(), 3);
}

#[tokio::test]
async fn anthropic_pagination_has_a_page_limit() {
	let responses = (0..MAX_ANTHROPIC_PAGES)
		.map(|index| {
			TestResponse::json(format!(
				r#"{{"data":[],"has_more":true,"last_id":"{index}"}}"#
			))
		})
		.collect();
	let (base_url, requests) = spawn_server(responses);

	let error =
		discover_models(request(InferenceProviderFormat::Anthropic, &base_url))
			.await
			.unwrap_err();

	assert!(matches!(
		error,
		ModelDiscoveryError::TooManyPages {
			limit: MAX_ANTHROPIC_PAGES
		}
	));
	assert_eq!(requests.recv().unwrap().len(), MAX_ANTHROPIC_PAGES);
}

#[tokio::test]
async fn redirects_are_not_followed_or_given_anthropic_credentials() {
	let (target_url, target_request) = spawn_probe_server();
	let redirect = TestResponse {
		status: "302 Found",
		headers: vec![(
			"Location".to_string(),
			format!("{target_url}/v1/models"),
		)],
		body: String::new(),
		include_content_length: true,
	};
	let (base_url, requests) = spawn_server(vec![redirect]);

	let error =
		discover_models(request(InferenceProviderFormat::Anthropic, &base_url))
			.await
			.unwrap_err();

	assert!(matches!(
		error,
		ModelDiscoveryError::UpstreamStatus(StatusCode::FOUND)
	));
	assert!(target_request.recv().unwrap().is_none());
	let requests = requests.recv().unwrap();
	assert_eq!(
		requests[0].headers.get("x-api-key").map(String::as_str),
		Some("secret")
	);
}

#[tokio::test]
async fn response_body_is_bounded_without_content_length() {
	let response = TestResponse {
		status: "200 OK",
		headers: vec![(
			"Content-Type".to_string(),
			"application/json".to_string(),
		)],
		body: "x".repeat(MAX_MODEL_RESPONSE_BYTES + 1),
		include_content_length: false,
	};
	let (base_url, requests) = spawn_server(vec![response]);

	let error = discover_models(request(
		InferenceProviderFormat::OpenAiResponses,
		&base_url,
	))
	.await
	.unwrap_err();

	assert!(matches!(
		error,
		ModelDiscoveryError::ResponseTooLarge { .. }
	));
	requests.recv().unwrap();
}

#[tokio::test]
async fn model_count_at_limit_is_accepted() {
	let data = (0..MAX_DISCOVERED_MODELS)
		.map(|index| format!(r#"{{"id":"model-{index}"}}"#))
		.collect::<Vec<_>>()
		.join(",");
	let (base_url, requests) = spawn_server(vec![TestResponse::json(format!(
		r#"{{"data":[{data}]}}"#
	))]);

	let models = discover_models(request(
		InferenceProviderFormat::OpenAiResponses,
		&base_url,
	))
	.await
	.unwrap();

	assert_eq!(models.len(), MAX_DISCOVERED_MODELS);
	requests.recv().unwrap();
}

#[tokio::test]
async fn model_count_above_limit_is_rejected() {
	let data = (0..=MAX_DISCOVERED_MODELS)
		.map(|index| format!(r#"{{"id":"model-{index}"}}"#))
		.collect::<Vec<_>>()
		.join(",");
	let (base_url, requests) = spawn_server(vec![TestResponse::json(format!(
		r#"{{"data":[{data}]}}"#
	))]);

	let error = discover_models(request(
		InferenceProviderFormat::OpenAiResponses,
		&base_url,
	))
	.await
	.unwrap_err();

	assert!(matches!(error, ModelDiscoveryError::TooManyModels { .. }));
	requests.recv().unwrap();
}

#[tokio::test]
async fn model_identifier_length_is_bounded() {
	let id = "x".repeat(MAX_MODEL_ID_BYTES + 1);
	let (base_url, requests) = spawn_server(vec![TestResponse::json(format!(
		r#"{{"data":[{{"id":"{id}"}}]}}"#
	))]);

	let error = discover_models(request(
		InferenceProviderFormat::OpenAiResponses,
		&base_url,
	))
	.await
	.unwrap_err();

	assert!(matches!(error, ModelDiscoveryError::ModelIdTooLong { .. }));
	requests.recv().unwrap();
}

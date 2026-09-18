//! GPUI `HttpClient` backed by nyquest: platform-native HTTP and TLS
//! (NSURLSession on Apple platforms, system proxy and certificate stores).

use std::sync::Arc;

use futures::future::BoxFuture;
use futures::{AsyncReadExt as _, FutureExt as _};
use gpui_kit::http_client::http::header::HeaderValue;
use gpui_kit::http_client::http::{Request, Response, StatusCode};
use gpui_kit::http_client::{AsyncBody, HttpClient, Result, Url};
use tokio::sync::OnceCell;

/// Registers the platform-native nyquest backend. Must run before
/// [`client`], and before any window renders network images.
#[cfg(target_vendor = "apple")]
pub fn register_backend() {
	nyquest_backend_nsurlsession::register();
}

#[cfg(not(target_vendor = "apple"))]
pub fn register_backend() {}

/// The `HttpClient` to install via `Application::with_http_client`.
#[cfg(target_vendor = "apple")]
pub fn client() -> Arc<dyn HttpClient> {
	Arc::new(NyquestClient {
		client: Arc::new(OnceCell::new()),
	})
}

#[cfg(not(target_vendor = "apple"))]
pub fn client() -> Arc<dyn HttpClient> {
	Arc::new(UnavailableClient)
}

struct NyquestClient {
	client: Arc<OnceCell<anyhow::Result<nyquest::AsyncClient>>>,
}

impl HttpClient for NyquestClient {
	fn user_agent(&self) -> Option<&HeaderValue> {
		None
	}

	fn proxy(&self) -> Option<&Url> {
		None
	}

	fn send(
		&self,
		request: Request<AsyncBody>,
	) -> BoxFuture<'static, Result<Response<AsyncBody>>> {
		let cell = self.client.clone();
		async move {
			let method =
				nyquest::Method::custom(request.method().as_str().to_owned());
			let uri = request.uri().to_string();
			let content_type = request
				.headers()
				.get("content-type")
				.and_then(|value| value.to_str().ok())
				.unwrap_or("application/octet-stream")
				.to_owned();
			let mut nyquest_request =
				nyquest::r#async::Request::new(method, uri);
			for (name, value) in request.headers() {
				let name = name.as_str();
				if name.eq_ignore_ascii_case("content-type")
					|| name.eq_ignore_ascii_case("content-length")
				{
					continue;
				}
				nyquest_request = nyquest_request.with_header(
					name.to_owned(),
					value.to_str().unwrap_or_default().to_owned(),
				);
			}
			let mut body = Vec::new();
			request.into_body().read_to_end(&mut body).await.ok();
			if !body.is_empty() {
				nyquest_request = nyquest_request
					.with_body(nyquest::Body::bytes(body, content_type));
			}
			let client = cell
				.get_or_init(|| async {
					nyquest::ClientBuilder::default()
						.request_timeout(std::time::Duration::from_secs(30))
						.build_async()
						.await
						.map_err(anyhow::Error::from)
				})
				.await
				.as_ref()
				.map_err(|error| anyhow::anyhow!("{error:#}"))?
				.clone();
			let response = client
				.request(nyquest_request)
				.await
				.map_err(anyhow::Error::new)?;
			let status = response.status();
			let mut builder = Response::builder()
				.status(StatusCode::from_u16(status.code())?);
			for name in ["content-type", "content-length"] {
				if let Ok(values) = response.get_header(name) {
					for value in values {
						builder = builder.header(name, value);
					}
				}
			}
			let bytes = response.bytes().await.map_err(anyhow::Error::new)?;
			builder
				.body(AsyncBody::from(bytes))
				.map_err(|error| anyhow::anyhow!(error))
		}
		.boxed()
	}
}

#[cfg(not(target_vendor = "apple"))]
struct UnavailableClient;

#[cfg(not(target_vendor = "apple"))]
impl HttpClient for UnavailableClient {
	fn user_agent(&self) -> Option<&HeaderValue> {
		None
	}

	fn proxy(&self) -> Option<&Url> {
		None
	}

	fn send(
		&self,
		_request: Request<AsyncBody>,
	) -> BoxFuture<'static, Result<Response<AsyncBody>>> {
		async move {
			anyhow::bail!("no native HTTP backend registered for this platform")
		}
		.boxed()
	}
}

#[cfg(all(test, target_vendor = "apple"))]
mod tests {
	use super::*;

	#[test]
	#[ignore = "hits the network"]
	fn native_backend_fetches_catalog_feed() {
		register_backend();
		let client = client();
		let uri = "https://raw.githubusercontent.com/aghub-app/agent-plugin-awesome/main/out/all.json";
		let request = Request::get(uri).body(AsyncBody::empty()).unwrap();
		let response =
			futures::executor::block_on(client.send(request)).unwrap();
		assert!(response.status().is_success());
		let mut body = Vec::new();
		futures::executor::block_on(
			response.into_body().read_to_end(&mut body),
		)
		.unwrap();
		let text = String::from_utf8_lossy(&body);
		assert!(
			text.contains("\"plugins\""),
			"unexpected body: {}",
			&text[..text.len().min(80)]
		);
	}
}

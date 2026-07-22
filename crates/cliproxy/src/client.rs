//! Typed client for the CLIProxyAPI management API (`/v0/management`).
//!
//! Only the endpoint subset aghub actually uses is wrapped; everything else
//! stays reachable through the raw `config.yaml` passthrough. Scalar GET
//! responses are wrapped in the endpoint's last path segment
//! (`{"debug": true}`), scalar PUTs send `{"value": …}`.

use std::time::Duration;

use serde::Deserialize;
use url::Url;

use crate::dto::{
	GatewayAuthFileDto, GatewayAuthPollDto, GatewayAuthUrlDto,
	GatewayCompatModelDto, GatewayCompatProviderDto, GatewayOauthProvider,
	GatewaySettingKind, GatewaySettingValue, GatewayUpstreamKeyDto,
	GatewayUpstreamProvider,
};
use crate::error::{GatewayError, Result};
use crate::settings::{response_key, GatewaySettingSpec};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

pub struct ManagementClient {
	http: reqwest::Client,
	base_url: Url,
	key: String,
}

#[derive(Deserialize)]
struct ErrorBody {
	error: Option<String>,
	message: Option<String>,
}

#[derive(Deserialize)]
struct AuthFilesBody {
	#[serde(default)]
	files: Vec<GatewayAuthFileDto>,
}

#[derive(Deserialize)]
struct ApiKeysBody {
	#[serde(rename = "api-keys")]
	keys: Vec<String>,
}

/// Upstream key element as the management API speaks it (kebab-case).
/// Kept separate from the snake_case DTO the aghub API serves.
#[derive(serde::Serialize, Deserialize)]
struct UpstreamKeyWire {
	#[serde(rename = "api-key")]
	api_key: String,
	#[serde(rename = "base-url", skip_serializing_if = "Option::is_none")]
	#[serde(default)]
	base_url: Option<String>,
	#[serde(rename = "auth-index", default, skip_serializing)]
	auth_index: Option<String>,
}

#[derive(serde::Serialize, Deserialize)]
struct CompatModelWire {
	name: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	alias: Option<String>,
}

#[derive(serde::Serialize, Deserialize)]
struct CompatProviderWire {
	name: String,
	#[serde(rename = "base-url")]
	base_url: String,
	#[serde(rename = "api-keys", default)]
	api_keys: Vec<String>,
	#[serde(default)]
	models: Vec<CompatModelWire>,
	#[serde(default)]
	disabled: bool,
	#[serde(rename = "auth-index", default, skip_serializing)]
	auth_index: Option<String>,
}

/// Logs tail as the management API speaks it (kebab-case fields,
/// probed) — mapped to the snake_case DTO aghub serves.
#[derive(Deserialize)]
struct LogsWire {
	#[serde(rename = "latest-timestamp", default)]
	latest_timestamp: Option<i64>,
	#[serde(rename = "line-count", default)]
	line_count: u64,
	#[serde(default)]
	lines: Vec<String>,
}

fn upstream_endpoint(provider: GatewayUpstreamProvider) -> &'static str {
	match provider {
		GatewayUpstreamProvider::Gemini => "gemini-api-key",
		GatewayUpstreamProvider::Claude => "claude-api-key",
		GatewayUpstreamProvider::Codex => "codex-api-key",
	}
}

impl ManagementClient {
	pub fn new(base_url: &str, key: &str) -> Result<Self> {
		let base_url = Url::parse(base_url).map_err(|error| {
			GatewayError::Invalid(format!(
				"invalid gateway base URL '{base_url}': {error}"
			))
		})?;
		let http = reqwest::Client::builder()
			.connect_timeout(CONNECT_TIMEOUT)
			.timeout(REQUEST_TIMEOUT)
			.build()?;
		Ok(Self {
			http,
			base_url,
			key: key.to_string(),
		})
	}

	pub fn base_url(&self) -> &Url {
		&self.base_url
	}

	fn endpoint(&self, path: &str) -> Result<Url> {
		self.base_url
			.join(&format!("/v0/management/{path}"))
			.map_err(|error| {
				GatewayError::Invalid(format!(
					"invalid management path '{path}': {error}"
				))
			})
	}

	async fn send(
		&self,
		request: reqwest::RequestBuilder,
	) -> Result<reqwest::Response> {
		let response =
			request
				.bearer_auth(&self.key)
				.send()
				.await
				.map_err(|error| {
					if error.is_connect() || error.is_timeout() {
						GatewayError::Unreachable {
							base_url: self.base_url.to_string(),
							message: error.to_string(),
						}
					} else {
						GatewayError::Http(error)
					}
				})?;
		let status = response.status();
		if status.is_success() {
			return Ok(response);
		}
		let message = match response.json::<ErrorBody>().await {
			Ok(body) => body
				.message
				.or(body.error)
				.unwrap_or_else(|| status.to_string()),
			Err(_) => status.to_string(),
		};
		Err(GatewayError::Management {
			status: status.as_u16(),
			message,
		})
	}

	async fn get_json(&self, path: &str) -> Result<serde_json::Value> {
		let response = self.send(self.http.get(self.endpoint(path)?)).await?;
		Ok(response.json().await?)
	}

	async fn put_value(
		&self,
		path: &str,
		value: serde_json::Value,
	) -> Result<()> {
		self.send(
			self.http
				.put(self.endpoint(path)?)
				.json(&serde_json::json!({ "value": value })),
		)
		.await?;
		Ok(())
	}

	/// `GET /config` — also the cheapest authenticated liveness probe.
	pub async fn ping(&self) -> Result<()> {
		self.get_json("config").await.map(|_| ())
	}

	pub async fn setting(
		&self,
		spec: &GatewaySettingSpec,
	) -> Result<GatewaySettingValue> {
		let body = self.get_json(spec.key).await?;
		let raw = body
			.get(response_key(spec.key))
			.cloned()
			.unwrap_or(serde_json::Value::Null);
		parse_setting_value(spec, &raw)
	}

	pub async fn set_setting(
		&self,
		spec: &GatewaySettingSpec,
		value: &GatewaySettingValue,
	) -> Result<()> {
		let raw = match (spec.kind, value) {
			(GatewaySettingKind::Bool, GatewaySettingValue::Bool(v)) => {
				serde_json::json!(v)
			}
			(GatewaySettingKind::Integer, GatewaySettingValue::Integer(v)) => {
				serde_json::json!(v)
			}
			(GatewaySettingKind::Text, GatewaySettingValue::Text(v)) => {
				// An emptied text setting means "unset" upstream.
				if v.trim().is_empty() {
					self.send(self.http.delete(self.endpoint(spec.key)?))
						.await?;
					return Ok(());
				}
				serde_json::json!(v)
			}
			_ => {
				return Err(GatewayError::Invalid(format!(
					"setting '{}' expects a {:?} value",
					spec.key, spec.kind
				)))
			}
		};
		self.put_value(spec.key, raw).await
	}

	pub async fn auth_files(&self) -> Result<Vec<GatewayAuthFileDto>> {
		let body = self.get_json("auth-files").await?;
		let parsed: AuthFilesBody = serde_json::from_value(body)?;
		Ok(parsed.files)
	}

	pub async fn upload_auth_file(
		&self,
		name: &str,
		content: &str,
	) -> Result<()> {
		self.send(
			self.http
				.post(self.endpoint("auth-files")?)
				.query(&[("name", name)])
				.header(reqwest::header::CONTENT_TYPE, "application/json")
				.body(content.to_string()),
		)
		.await?;
		Ok(())
	}

	pub async fn download_auth_file(&self, name: &str) -> Result<String> {
		let response = self
			.send(
				self.http
					.get(self.endpoint("auth-files/download")?)
					.query(&[("name", name)]),
			)
			.await?;
		Ok(response.text().await?)
	}

	pub async fn delete_auth_file(&self, name: &str) -> Result<()> {
		self.send(
			self.http
				.delete(self.endpoint("auth-files")?)
				.query(&[("name", name)]),
		)
		.await?;
		Ok(())
	}

	/// Start an OAuth login on the instance; the returned URL is opened in
	/// the user's browser and `auth_status` is polled with `state`.
	pub async fn auth_url(
		&self,
		provider: GatewayOauthProvider,
	) -> Result<GatewayAuthUrlDto> {
		let path = match provider {
			GatewayOauthProvider::Anthropic => "anthropic-auth-url",
			GatewayOauthProvider::Codex => "codex-auth-url",
			GatewayOauthProvider::Antigravity => "antigravity-auth-url",
			GatewayOauthProvider::Kimi => "kimi-auth-url",
			GatewayOauthProvider::Xai => "xai-auth-url",
		};
		let response = self
			.send(
				self.http
					.get(self.endpoint(path)?)
					.query(&[("is_webui", "true")]),
			)
			.await?;
		Ok(response.json().await?)
	}

	pub async fn auth_status(&self, state: &str) -> Result<GatewayAuthPollDto> {
		let response = self
			.send(
				self.http
					.get(self.endpoint("get-auth-status")?)
					.query(&[("state", state)]),
			)
			.await?;
		Ok(response.json().await?)
	}

	pub async fn api_keys(&self) -> Result<Vec<String>> {
		let body = self.get_json("api-keys").await?;
		Ok(serde_json::from_value::<ApiKeysBody>(body)?.keys)
	}

	pub async fn set_api_keys(&self, keys: &[String]) -> Result<()> {
		self.send(
			self.http
				.put(self.endpoint("api-keys")?)
				.json(&serde_json::json!(keys)),
		)
		.await?;
		Ok(())
	}

	/// provider name → upstream identifier → success/failed counters.
	pub async fn api_key_usage(
		&self,
	) -> Result<
		std::collections::HashMap<
			String,
			std::collections::HashMap<String, crate::dto::GatewayKeyUsageDto>,
		>,
	> {
		let body = self.get_json("api-key-usage").await?;
		Ok(serde_json::from_value(body)?)
	}

	pub async fn config_yaml(&self) -> Result<String> {
		let response = self
			.send(self.http.get(self.endpoint("config.yaml")?))
			.await?;
		Ok(response.text().await?)
	}

	pub async fn put_config_yaml(&self, content: &str) -> Result<()> {
		self.send(
			self.http
				.put(self.endpoint("config.yaml")?)
				.header(reqwest::header::CONTENT_TYPE, "application/yaml")
				.body(content.to_string()),
		)
		.await?;
		Ok(())
	}

	pub async fn latest_version(&self) -> Result<String> {
		let body = self.get_json("latest-version").await?;
		// Release tags come back with their `v` prefix ("v7.2.81");
		// normalize so callers compare against the bare installed version.
		Ok(body
			.get("latest-version")
			.and_then(|value| value.as_str())
			.unwrap_or_default()
			.trim_start_matches('v')
			.to_string())
	}

	pub async fn upstream_keys(
		&self,
		provider: GatewayUpstreamProvider,
	) -> Result<Vec<GatewayUpstreamKeyDto>> {
		let endpoint = upstream_endpoint(provider);
		let body = self.get_json(endpoint).await?;
		let raw = body
			.get(endpoint)
			.cloned()
			.unwrap_or(serde_json::Value::Array(Vec::new()));
		let wire: Vec<UpstreamKeyWire> = serde_json::from_value(raw)?;
		Ok(wire
			.into_iter()
			.map(|key| GatewayUpstreamKeyDto {
				api_key: key.api_key,
				base_url: key.base_url,
				auth_index: key.auth_index,
			})
			.collect())
	}

	/// Append one key while retaining fields this UI does not edit, such as
	/// proxy settings, headers, and excluded models.
	pub async fn add_upstream_key(
		&self,
		provider: GatewayUpstreamProvider,
		api_key: &str,
		base_url: Option<&str>,
	) -> Result<()> {
		let endpoint = upstream_endpoint(provider);
		let body = self.get_json(endpoint).await?;
		let mut entries = body
			.get(endpoint)
			.and_then(serde_json::Value::as_array)
			.cloned()
			.ok_or_else(|| {
				GatewayError::Invalid(format!(
					"{endpoint} returned an unexpected payload"
				))
			})?;
		let mut entry = serde_json::json!({ "api-key": api_key });
		if let Some(base_url) = base_url {
			entry["base-url"] = serde_json::json!(base_url);
		}
		entries.push(entry);
		self.send(self.http.put(self.endpoint(endpoint)?).json(&entries))
			.await?;
		Ok(())
	}

	pub async fn delete_upstream_key(
		&self,
		provider: GatewayUpstreamProvider,
		api_key: &str,
	) -> Result<()> {
		self.send(
			self.http
				.delete(self.endpoint(upstream_endpoint(provider))?)
				.query(&[("api-key", api_key)]),
		)
		.await?;
		Ok(())
	}

	/// OpenAI-compatibility uplinks. `api_keys` is write-only wire-wide:
	/// keys move into the server's auth store on write (probed: neither
	/// this endpoint nor `GET /config` echoes them) and stay associated
	/// via a stable `auth-index`, so replaying entries without keys does
	/// not lose them. Reads therefore return `api_keys` empty.
	pub async fn compat_providers(
		&self,
	) -> Result<Vec<GatewayCompatProviderDto>> {
		let body = self.get_json("openai-compatibility").await?;
		let raw = body
			.get("openai-compatibility")
			.cloned()
			.unwrap_or(serde_json::Value::Array(Vec::new()));
		let raw = if raw.is_null() {
			serde_json::Value::Array(Vec::new())
		} else {
			raw
		};
		let wire: Vec<CompatProviderWire> = serde_json::from_value(raw)?;
		Ok(wire.into_iter().map(compat_wire_to_dto).collect())
	}

	pub async fn add_compat_provider(
		&self,
		provider: &GatewayCompatProviderDto,
	) -> Result<()> {
		let body = self.get_json("openai-compatibility").await?;
		let mut entries = match body.get("openai-compatibility") {
			Some(serde_json::Value::Array(entries)) => entries.clone(),
			Some(serde_json::Value::Null) => Vec::new(),
			_ => {
				return Err(GatewayError::Invalid(
					"openai-compatibility returned an unexpected payload"
						.to_string(),
				))
			}
		};
		entries.retain(|entry| {
			entry.get("name").and_then(serde_json::Value::as_str)
				!= Some(provider.name.as_str())
		});
		entries
			.push(serde_json::to_value(compat_dto_to_wire(provider.clone()))?);
		self.send(
			self.http
				.put(self.endpoint("openai-compatibility")?)
				.json(&entries),
		)
		.await?;
		Ok(())
	}

	pub async fn delete_compat_provider(&self, name: &str) -> Result<()> {
		self.send(
			self.http
				.delete(self.endpoint("openai-compatibility")?)
				.query(&[("name", name)]),
		)
		.await?;
		Ok(())
	}

	/// Tail of the instance's file log. Errors with a management message
	/// while `logging-to-file` is off; callers surface that as guidance.
	pub async fn logs(&self) -> Result<crate::dto::GatewayLogsDto> {
		let response = self.send(self.http.get(self.endpoint("logs")?)).await?;
		let wire: LogsWire = response.json().await?;
		Ok(crate::dto::GatewayLogsDto {
			latest_timestamp: wire.latest_timestamp,
			line_count: wire.line_count,
			lines: wire.lines,
		})
	}

	pub async fn clear_logs(&self) -> Result<()> {
		self.send(self.http.delete(self.endpoint("logs")?)).await?;
		Ok(())
	}

	/// provider id → excluded model names; upstream stores `null` for the
	/// empty state.
	pub async fn oauth_excluded_models(
		&self,
	) -> Result<std::collections::HashMap<String, Vec<String>>> {
		let body = self.get_json("oauth-excluded-models").await?;
		let raw = body
			.get("oauth-excluded-models")
			.cloned()
			.unwrap_or(serde_json::Value::Null);
		if raw.is_null() {
			return Ok(std::collections::HashMap::new());
		}
		Ok(serde_json::from_value(raw)?)
	}

	pub async fn set_oauth_excluded_models(
		&self,
		providers: &std::collections::HashMap<String, Vec<String>>,
	) -> Result<()> {
		self.send(
			self.http
				.put(self.endpoint("oauth-excluded-models")?)
				.json(providers),
		)
		.await?;
		Ok(())
	}

	/// Import a Vertex service-account JSON (multipart `file` field).
	pub async fn import_vertex(
		&self,
		file_name: &str,
		content: &str,
	) -> Result<()> {
		let part = reqwest::multipart::Part::text(content.to_string())
			.file_name(file_name.to_string())
			.mime_str("application/json")
			.map_err(GatewayError::Http)?;
		let form = reqwest::multipart::Form::new().part("file", part);
		self.send(
			self.http
				.post(self.endpoint("vertex/import")?)
				.multipart(form),
		)
		.await?;
		Ok(())
	}

	/// Clear the quota/cooldown state of one credential.
	pub async fn reset_quota(&self, auth_index: &str) -> Result<()> {
		self.send(
			self.http
				.post(self.endpoint("reset-quota")?)
				.json(&serde_json::json!({ "auth_index": auth_index })),
		)
		.await?;
		Ok(())
	}

	/// Model ids the gateway currently serves, from the OpenAI-compatible
	/// `/v1/models` (a proxy business endpoint, so it authenticates with a
	/// gateway key, not the management key).
	pub async fn list_models(&self, gateway_key: &str) -> Result<Vec<String>> {
		let url = self.base_url.join("/v1/models").map_err(|error| {
			GatewayError::Invalid(format!("invalid models URL: {error}"))
		})?;
		let response = self
			.http
			.get(url)
			.bearer_auth(gateway_key)
			.send()
			.await
			.map_err(|error| {
				if error.is_connect() || error.is_timeout() {
					GatewayError::Unreachable {
						base_url: self.base_url.to_string(),
						message: error.to_string(),
					}
				} else {
					GatewayError::Http(error)
				}
			})?
			.error_for_status()
			.map_err(GatewayError::Http)?;
		let body: serde_json::Value = response.json().await?;
		let mut models: Vec<String> = body
			.get("data")
			.and_then(serde_json::Value::as_array)
			.map(|entries| {
				entries
					.iter()
					.filter_map(|entry| entry.get("id"))
					.filter_map(serde_json::Value::as_str)
					.map(str::to_string)
					.collect()
			})
			.unwrap_or_default();
		models.sort();
		models.dedup();
		Ok(models)
	}
}

fn compat_wire_to_dto(wire: CompatProviderWire) -> GatewayCompatProviderDto {
	GatewayCompatProviderDto {
		name: wire.name,
		base_url: wire.base_url,
		api_keys: wire.api_keys,
		models: wire
			.models
			.into_iter()
			.map(|model| GatewayCompatModelDto {
				name: model.name,
				alias: model.alias,
			})
			.collect(),
		disabled: wire.disabled,
		auth_index: wire.auth_index,
	}
}

fn compat_dto_to_wire(dto: GatewayCompatProviderDto) -> CompatProviderWire {
	CompatProviderWire {
		name: dto.name,
		base_url: dto.base_url,
		api_keys: dto.api_keys,
		models: dto
			.models
			.into_iter()
			.map(|model| CompatModelWire {
				name: model.name,
				alias: model.alias,
			})
			.collect(),
		disabled: dto.disabled,
		auth_index: None,
	}
}

fn parse_setting_value(
	spec: &GatewaySettingSpec,
	raw: &serde_json::Value,
) -> Result<GatewaySettingValue> {
	let parsed = match spec.kind {
		GatewaySettingKind::Bool => {
			raw.as_bool().map(GatewaySettingValue::Bool)
		}
		GatewaySettingKind::Integer => {
			raw.as_i64().map(GatewaySettingValue::Integer)
		}
		GatewaySettingKind::Text => match raw {
			serde_json::Value::Null => {
				Some(GatewaySettingValue::Text(String::new()))
			}
			value => value
				.as_str()
				.map(|text| GatewaySettingValue::Text(text.to_string())),
		},
	};
	parsed.ok_or_else(|| {
		GatewayError::Invalid(format!(
			"setting '{}' returned unexpected payload: {raw}",
			spec.key
		))
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::settings;
	use std::io::{Read, Write};
	use std::net::TcpListener;
	use std::sync::{Arc, Mutex};

	/// Minimal single-purpose HTTP responder: answers every connection with
	/// the given status/body and records the last raw request.
	fn spawn_mock(
		status: u16,
		body: &'static str,
	) -> (String, Arc<Mutex<String>>) {
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock");
		let addr = listener.local_addr().expect("mock addr");
		let seen = Arc::new(Mutex::new(String::new()));
		let recorded = Arc::clone(&seen);
		std::thread::spawn(move || {
			for stream in listener.incoming() {
				let Ok(mut stream) = stream else { break };
				let mut buffer = [0_u8; 8192];
				let read = stream.read(&mut buffer).unwrap_or(0);
				*recorded.lock().expect("mock lock") =
					String::from_utf8_lossy(&buffer[..read]).to_string();
				let response = format!(
					"HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
					body.len()
				);
				let _ = stream.write_all(response.as_bytes());
			}
		});
		(format!("http://{addr}"), seen)
	}

	fn client(base: &str) -> ManagementClient {
		ManagementClient::new(base, "test-key").expect("client")
	}

	#[tokio::test]
	async fn setting_get_unwraps_last_path_segment() {
		let (base, _) = spawn_mock(200, r#"{"switch-project":true}"#);
		let spec = settings::find("quota-exceeded/switch-project").unwrap();
		let value = client(&base).setting(spec).await.expect("setting");
		assert_eq!(value, GatewaySettingValue::Bool(true));
	}

	#[tokio::test]
	async fn setting_put_sends_bearer_and_value_envelope() {
		let (base, seen) = spawn_mock(200, r#"{"status":"ok"}"#);
		let spec = settings::find("debug").unwrap();
		client(&base)
			.set_setting(spec, &GatewaySettingValue::Bool(true))
			.await
			.expect("set");
		let request = seen.lock().expect("seen").clone();
		assert!(request.starts_with("PUT /v0/management/debug"));
		assert!(
			request.contains("authorization: Bearer test-key")
				|| request.contains("Authorization: Bearer test-key")
		);
		assert!(request.contains(r#"{"value":true}"#));
	}

	#[tokio::test]
	async fn empty_text_setting_becomes_delete() {
		let (base, seen) = spawn_mock(200, r#"{"status":"ok"}"#);
		let spec = settings::find("proxy-url").unwrap();
		client(&base)
			.set_setting(spec, &GatewaySettingValue::Text("  ".into()))
			.await
			.expect("clear");
		let request = seen.lock().expect("seen").clone();
		assert!(request.starts_with("DELETE /v0/management/proxy-url"));
	}

	#[tokio::test]
	async fn management_error_body_is_surfaced() {
		let (base, _) =
			spawn_mock(401, r#"{"error":"invalid management key"}"#);
		let error = client(&base).ping().await.expect_err("must fail");
		match error {
			GatewayError::Management { status, message } => {
				assert_eq!(status, 401);
				assert_eq!(message, "invalid management key");
			}
			other => panic!("unexpected error: {other:?}"),
		}
	}

	#[tokio::test]
	async fn unreachable_port_maps_to_unreachable() {
		let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
		let base = format!("http://{}", listener.local_addr().expect("addr"));
		drop(listener);
		let error = client(&base).ping().await.expect_err("must fail");
		assert!(matches!(error, GatewayError::Unreachable { .. }));
	}

	#[tokio::test]
	async fn auth_files_tolerate_sparse_fields() {
		let (base, _) = spawn_mock(
			200,
			r#"{"files":[{"name":"acc.json","provider":"anthropic","email":"a@b.c","disabled":false,"success":3,"failed":1},{"name":"bare.json"}]}"#,
		);
		let files = client(&base).auth_files().await.expect("files");
		assert_eq!(files.len(), 2);
		assert_eq!(files[0].email.as_deref(), Some("a@b.c"));
		assert_eq!(files[1].name, "bare.json");
		assert_eq!(files[1].success, None);
	}

	#[tokio::test]
	async fn api_keys_unwrap_list() {
		let (base, _) = spawn_mock(200, r#"{"api-keys":["k1","k2"]}"#);
		let keys = client(&base).api_keys().await.expect("keys");
		assert_eq!(keys, vec!["k1".to_string(), "k2".to_string()]);
	}

	#[tokio::test]
	async fn api_keys_rejects_a_missing_list() {
		let (base, _) = spawn_mock(200, r#"{"status":"ok"}"#);
		let error = client(&base)
			.api_keys()
			.await
			.expect_err("missing api-keys must fail");
		assert!(matches!(error, GatewayError::Json(_)));
	}

	#[tokio::test]
	async fn latest_version_strips_tag_prefix() {
		let (base, _) = spawn_mock(200, r#"{"latest-version":"v7.2.82"}"#);
		let latest = client(&base).latest_version().await.expect("latest");
		assert_eq!(latest, "7.2.82");
	}

	#[tokio::test]
	async fn upstream_keys_map_kebab_wire_to_dto() {
		let (base, _) = spawn_mock(
			200,
			r#"{"claude-api-key":[{"api-key":"sk-1","base-url":"https://r.io","proxy-url":"","models":null,"auth-index":"idx1"}]}"#,
		);
		let keys = client(&base)
			.upstream_keys(GatewayUpstreamProvider::Claude)
			.await
			.expect("keys");
		assert_eq!(keys.len(), 1);
		assert_eq!(keys[0].api_key, "sk-1");
		assert_eq!(keys[0].base_url.as_deref(), Some("https://r.io"));
		assert_eq!(keys[0].auth_index.as_deref(), Some("idx1"));
	}

	#[tokio::test]
	async fn add_upstream_key_preserves_unmanaged_fields() {
		let (base, seen) = spawn_mock(
			200,
			concat!(
				r#"{"claude-api-key":[{"api-key":"existing","#,
				r#""base-url":"https://r.io","#,
				r#""headers":{"X-Team":"prod"},"#,
				r#""proxy-url":"socks5://proxy","#,
				r#""excluded-models":["old-model"]}]}"#
			),
		);
		client(&base)
			.add_upstream_key(
				GatewayUpstreamProvider::Claude,
				"new-key",
				Some("https://new.example"),
			)
			.await
			.expect("add key");
		let request = seen.lock().expect("seen").clone();
		assert!(request.contains(r#""headers":{"X-Team":"prod"}"#));
		assert!(request.contains(r#""proxy-url":"socks5://proxy""#));
		assert!(request.contains(r#""excluded-models":["old-model"]"#));
	}

	#[tokio::test]
	async fn add_compat_provider_preserves_existing_provider_fields() {
		let (base, seen) = spawn_mock(
			200,
			concat!(
				r#"{"openai-compatibility":[{"name":"existing","#,
				r#""base-url":"https://r.io","#,
				r#""api-key-entries":[{"api-key":"old-key","#,
				r#""auth-index":"idx1"}],"#,
				r#""headers":{"X-Team":"prod"},"models":[]}]}"#
			),
		);
		client(&base)
			.add_compat_provider(&GatewayCompatProviderDto {
				name: "new-provider".to_string(),
				base_url: "https://new.example".to_string(),
				api_keys: vec!["new-key".to_string()],
				models: Vec::new(),
				disabled: false,
				auth_index: None,
			})
			.await
			.expect("add provider");
		let request = seen.lock().expect("seen").clone();
		assert!(request.contains(
			r#""api-key-entries":[{"api-key":"old-key","auth-index":"idx1"}]"#
		));
		assert!(request.contains(r#""headers":{"X-Team":"prod"}"#));
	}

	#[tokio::test]
	async fn delete_upstream_key_uses_api_key_query() {
		let (base, seen) = spawn_mock(200, r#"{"status":"ok"}"#);
		client(&base)
			.delete_upstream_key(GatewayUpstreamProvider::Gemini, "AIza1")
			.await
			.expect("delete");
		let request = seen.lock().expect("seen").clone();
		assert!(request
			.starts_with("DELETE /v0/management/gemini-api-key?api-key=AIza1"));
	}

	#[tokio::test]
	async fn auth_url_requests_webui_flow() {
		let (base, seen) = spawn_mock(
			200,
			r#"{"status":"ok","url":"https://login","state":"anth-1"}"#,
		);
		let dto = client(&base)
			.auth_url(GatewayOauthProvider::Anthropic)
			.await
			.expect("auth url");
		assert_eq!(dto.state, "anth-1");
		let request = seen.lock().expect("seen").clone();
		assert!(request.starts_with(
			"GET /v0/management/anthropic-auth-url?is_webui=true"
		));
	}
}

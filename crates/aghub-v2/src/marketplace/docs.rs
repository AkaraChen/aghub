//! The real plugin files (`plugin.json`, `README.md`) fetched from each
//! plugin's directory next to `all.json`, cached per plugin id.

use std::collections::HashMap;

use anyhow::Context as _;
use futures::AsyncReadExt as _;
use futures::future::join3;
use gpui_kit::http_client::HttpClient;
use gpui_kit::http_client::http::StatusCode;
use gpui_kit::{Context, SharedString};
use serde::Deserialize;

use super::catalog::{Item, RAW_BASE};

#[derive(Default, Deserialize)]
struct AuthorRecord {
	#[serde(default)]
	name: String,
}

#[derive(Default, Deserialize)]
struct CursorExtension {
	#[serde(rename = "displayName", default)]
	display_name: String,
	#[serde(default)]
	logo: String,
}

#[derive(Default, Deserialize)]
struct Extensions {
	#[serde(rename = "com.cursor", default)]
	cursor: Option<CursorExtension>,
}

#[derive(Deserialize)]
struct ManifestRecord {
	name: String,
	#[serde(default)]
	version: String,
	#[serde(default)]
	description: String,
	#[serde(default)]
	author: AuthorRecord,
	#[serde(default)]
	homepage: String,
	#[serde(default)]
	repository: String,
	#[serde(default)]
	license: String,
	#[serde(default)]
	keywords: Vec<String>,
	#[serde(default)]
	extensions: Extensions,
}

/// The parsed `plugin.json` at the root of a plugin directory.
#[derive(Clone)]
pub struct Manifest {
	display_name: SharedString,
	version: SharedString,
	description: SharedString,
	author: SharedString,
	homepage: SharedString,
	license: SharedString,
	keywords: Vec<SharedString>,
	logo_url: Option<SharedString>,
}

impl Manifest {
	pub fn display_name(&self) -> &SharedString {
		&self.display_name
	}

	pub fn version(&self) -> &SharedString {
		&self.version
	}

	pub fn description(&self) -> &SharedString {
		&self.description
	}

	pub fn author(&self) -> &SharedString {
		&self.author
	}

	pub fn homepage(&self) -> &SharedString {
		&self.homepage
	}

	pub fn license(&self) -> &SharedString {
		&self.license
	}

	pub fn keywords(&self) -> &[SharedString] {
		&self.keywords
	}

	pub fn logo_url(&self) -> Option<&SharedString> {
		self.logo_url.as_ref()
	}
}

/// Fetch state of a plugin's real directory files.
#[derive(Clone)]
pub enum Doc {
	Loading,
	Ready {
		manifest: Option<Box<Manifest>>,
		readme: Option<SharedString>,
		/// MCP server names from the real `mcp.json`; `None` means the
		/// plugin directory has no `mcp.json`.
		mcp: Option<Vec<SharedString>>,
	},
	Failed(SharedString),
}

/// Fetches and caches the real plugin-directory files on demand.
pub struct Docs {
	docs: HashMap<SharedString, Doc>,
}

impl Docs {
	pub fn new() -> Self {
		Self {
			docs: HashMap::new(),
		}
	}

	pub fn doc(&self, id: &str) -> Doc {
		self.docs.get(id).cloned().unwrap_or(Doc::Loading)
	}

	/// Fetches `plugin.json` and `README.md` unless already cached; a failed
	/// entry is retried on the next call.
	pub fn ensure_loaded(&mut self, item: &Item, cx: &mut Context<Self>) {
		if matches!(
			self.docs.get(item.id()),
			Some(Doc::Loading | Doc::Ready { .. })
		) {
			return;
		}
		self.docs.insert(item.id().clone(), Doc::Loading);
		let client = cx.http_client();
		let id = item.id().clone();
		let base = format!("{RAW_BASE}/{}/", item.path());
		cx.spawn(async move |this, cx| {
			let manifest_url = format!("{base}plugin.json");
			let readme_url = format!("{base}README.md");
			let mcp_url = format!("{base}mcp.json");
			let manifest = fetch(client.as_ref(), &manifest_url);
			let readme = fetch(client.as_ref(), &readme_url);
			let mcp = fetch(client.as_ref(), &mcp_url);
			let (manifest, readme, mcp) = join3(manifest, readme, mcp).await;
			let doc = match (manifest, readme, mcp) {
				(Err(error), Err(_), Err(_)) => {
					Doc::Failed(format!("{error:#}").into())
				}
				(manifest, readme, mcp) => Doc::Ready {
					manifest: manifest.ok().flatten().and_then(|raw| {
						parse_manifest(&raw, &base).ok().map(Box::new)
					}),
					readme: readme.ok().flatten().map(SharedString::from),
					mcp: mcp
						.ok()
						.flatten()
						.and_then(|raw| parse_mcp_servers(&raw).ok()),
				},
			};
			this.update(cx, |this, cx| {
				this.docs.insert(id, doc);
				cx.notify();
			})
			.ok();
		})
		.detach();
	}
}

async fn fetch(
	client: &dyn HttpClient,
	url: &str,
) -> anyhow::Result<Option<String>> {
	let mut response = client.get(url, ().into(), true).await?;
	if response.status() == StatusCode::NOT_FOUND {
		return Ok(None);
	}
	let status = response.status();
	if !status.is_success() {
		anyhow::bail!("requesting {url} failed: {status}");
	}
	let mut body = Vec::new();
	response
		.body_mut()
		.read_to_end(&mut body)
		.await
		.context("reading response body")?;
	Ok(Some(String::from_utf8_lossy(&body).into_owned()))
}

#[derive(Deserialize)]
struct McpFile {
	#[serde(rename = "mcpServers", default)]
	servers: HashMap<String, serde_json::Value>,
}

/// The MCP server names declared by the real `mcp.json`.
fn parse_mcp_servers(raw: &str) -> anyhow::Result<Vec<SharedString>> {
	let file: McpFile =
		serde_json::from_str(raw).context("parsing mcp manifest")?;
	let mut names: Vec<SharedString> = file
		.servers
		.keys()
		.map(|name| name.as_str().into())
		.collect();
	names.sort();
	Ok(names)
}

fn parse_manifest(raw: &str, base: &str) -> anyhow::Result<Manifest> {
	let record: ManifestRecord =
		serde_json::from_str(raw).context("parsing plugin manifest")?;
	let name: SharedString = record.name.into();
	let cursor = record.extensions.cursor;
	let display_name = cursor
		.as_ref()
		.map(|cursor| cursor.display_name.clone())
		.filter(|display| !display.is_empty());
	let logo_url = cursor
		.as_ref()
		.filter(|cursor| !cursor.logo.is_empty())
		.map(|cursor| format!("{base}{}", cursor.logo).into());
	let homepage = if record.homepage.is_empty() {
		record.repository
	} else {
		record.homepage
	};
	Ok(Manifest {
		display_name: display_name.unwrap_or_else(|| name.to_string()).into(),
		version: record.version.into(),
		description: record.description.into(),
		author: record.author.name.into(),
		homepage: homepage.into(),
		license: record.license.into(),
		keywords: record.keywords.into_iter().map(Into::into).collect(),
		logo_url,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	const SAMPLE: &str = r#"{
		"name": "advisor",
		"version": "1.0.0",
		"description": "Consult a stronger model.",
		"author": { "name": "Cursor", "email": "plugins@cursor.com" },
		"homepage": "https://github.com/cursor/plugins/tree/main/advisor",
		"repository": "https://github.com/cursor/plugins",
		"license": "MIT",
		"keywords": ["advisor", "review"],
		"extensions": {
			"com.cursor": {
				"displayName": "Advisor",
				"logo": "assets/avatar.png"
			}
		}
	}"#;

	#[test]
	fn manifest_maps_real_directory_fields() {
		let manifest =
			parse_manifest(SAMPLE, "https://example/out/advisor/").unwrap();
		assert_eq!(manifest.display_name().as_ref(), "Advisor");
		assert_eq!(manifest.version().as_ref(), "1.0.0");
		assert_eq!(manifest.author().as_ref(), "Cursor");
		assert_eq!(manifest.license().as_ref(), "MIT");
		assert_eq!(manifest.keywords().len(), 2);
		assert_eq!(
			manifest.logo_url().map(SharedString::as_ref),
			Some("https://example/out/advisor/assets/avatar.png")
		);
	}

	#[test]
	fn manifest_falls_back_to_slug_and_repository() {
		let manifest =
			parse_manifest(r#"{"name":"x","repository":"https://r"}"#, "b/")
				.unwrap();
		assert_eq!(manifest.display_name().as_ref(), "x");
		assert_eq!(manifest.homepage().as_ref(), "https://r");
		assert_eq!(manifest.logo_url(), None);
	}

	#[test]
	fn malformed_manifest_is_an_error() {
		assert!(parse_manifest("{", "b/").is_err());
	}

	#[test]
	fn mcp_file_yields_sorted_server_names() {
		let names = parse_mcp_servers(
			r#"{"mcpServers":{"beta":{"url":"u"},"alpha":{"url":"u"}}}"#,
		)
		.unwrap();
		assert_eq!(
			names,
			vec![SharedString::from("alpha"), SharedString::from("beta")]
		);
	}
}

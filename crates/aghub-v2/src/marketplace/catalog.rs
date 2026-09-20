use std::sync::Arc;

use anyhow::Context as _;
use futures::AsyncReadExt as _;
use gpui_kit::http_client::HttpClient;
use gpui_kit::{Context, SharedString, Task};
use serde::Deserialize;

/// JSON feed published by `aghub-app/agent-plugin-awesome`.
pub const CATALOG_URL: &str = "https://raw.githubusercontent.com/aghub-app/agent-plugin-awesome/main/out/all.json";

/// Raw-file base used to resolve per-plugin relative assets (logos).
pub(crate) const RAW_BASE: &str =
	"https://raw.githubusercontent.com/aghub-app/agent-plugin-awesome/main/out";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
	All,
	Utilities,
	DeveloperTools,
	Productivity,
	Integrations,
}

impl Category {
	pub fn all() -> [Self; 5] {
		[
			Self::All,
			Self::Utilities,
			Self::DeveloperTools,
			Self::Productivity,
			Self::Integrations,
		]
	}

	pub fn from_index(ix: usize) -> Self {
		Self::all().get(ix).copied().unwrap_or(Self::All)
	}

	pub fn index(self) -> usize {
		Self::all()
			.iter()
			.position(|&category| category == self)
			.unwrap_or(0)
	}

	fn from_label(label: &str) -> Option<Self> {
		match label.to_ascii_lowercase().replace('_', "-").as_str() {
			"utilities" => Some(Self::Utilities),
			"developer-tools" | "developer tools" => Some(Self::DeveloperTools),
			"productivity" => Some(Self::Productivity),
			"integrations" => Some(Self::Integrations),
			_ => None,
		}
	}

	pub fn contains(self, item: &Item) -> bool {
		self == Self::All || item.category == self
	}
}

#[derive(Deserialize)]
struct CatalogFile {
	plugins: Vec<PluginRecord>,
}

#[derive(Clone, Default, Deserialize)]
struct AuthorRecord {
	#[serde(default)]
	name: String,
}

#[derive(Deserialize)]
struct PluginRecord {
	name: String,
	#[serde(default)]
	path: String,
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
	#[serde(rename = "displayName", default)]
	display_name: String,
	#[serde(default)]
	logo: Option<String>,
	category: String,
	#[serde(default)]
	skills: Vec<String>,
	#[serde(rename = "mcpServers", default)]
	mcp: Vec<String>,
}

#[derive(Clone)]
pub struct Item {
	pub(super) id: SharedString,
	pub(super) name: SharedString,
	pub(super) category: Category,
	pub(super) description: SharedString,
	path: SharedString,
	author: SharedString,
	version: SharedString,
	license: SharedString,
	homepage: SharedString,
	keywords: Vec<SharedString>,
	skills: Vec<SharedString>,
	mcp: Vec<SharedString>,
	logo_url: Option<SharedString>,
}

impl Item {
	pub fn id(&self) -> &SharedString {
		&self.id
	}

	pub fn name(&self) -> &SharedString {
		&self.name
	}

	pub fn description(&self) -> &SharedString {
		&self.description
	}

	pub fn category(&self) -> Category {
		self.category
	}

	/// Directory name of this plugin inside the catalog, used to reach the
	/// real plugin files next to `all.json`.
	pub fn path(&self) -> &SharedString {
		&self.path
	}

	pub fn author(&self) -> &SharedString {
		&self.author
	}

	pub fn version(&self) -> &SharedString {
		&self.version
	}

	pub fn license(&self) -> &SharedString {
		&self.license
	}

	pub fn homepage(&self) -> &SharedString {
		&self.homepage
	}

	pub fn keywords(&self) -> &[SharedString] {
		&self.keywords
	}

	pub fn logo_url(&self) -> Option<&SharedString> {
		self.logo_url.as_ref()
	}

	pub fn skills(&self) -> &[SharedString] {
		&self.skills
	}

	pub fn mcp(&self) -> &[SharedString] {
		&self.mcp
	}

	pub fn matches(&self, query: &str) -> bool {
		let query = query.trim();
		if query.is_empty() {
			return true;
		}
		let query = query.to_lowercase();
		self.name.as_ref().to_lowercase().contains(&query)
			|| self.id.as_ref().to_lowercase().contains(&query)
			|| self.description.as_ref().to_lowercase().contains(&query)
			|| self.author.as_ref().to_lowercase().contains(&query)
			|| self
				.keywords
				.iter()
				.any(|keyword| keyword.as_ref().to_lowercase().contains(&query))
			|| self
				.skills
				.iter()
				.any(|skill| skill.as_ref().to_lowercase().contains(&query))
			|| self
				.mcp
				.iter()
				.any(|server| server.as_ref().to_lowercase().contains(&query))
	}
}

fn parse_item(record: PluginRecord) -> Option<Item> {
	let category = Category::from_label(&record.category)?;
	let path = if record.path.is_empty() {
		record.name.clone()
	} else {
		record.path.clone()
	};
	let display_name = if record.display_name.is_empty() {
		record.name.clone()
	} else {
		record.display_name.clone()
	};
	let homepage = if record.homepage.is_empty() {
		record.repository.clone()
	} else {
		record.homepage.clone()
	};
	let logo_url = record
		.logo
		.as_deref()
		.filter(|logo| !logo.is_empty())
		.map(|logo| format!("{RAW_BASE}/{path}/{logo}").into());
	Some(Item {
		id: record.name.into(),
		name: display_name.into(),
		category,
		path: path.into(),
		description: record.description.into(),
		author: record.author.name.into(),
		version: record.version.into(),
		license: record.license.into(),
		homepage: homepage.into(),
		keywords: record.keywords.into_iter().map(Into::into).collect(),
		skills: record.skills.into_iter().map(Into::into).collect(),
		mcp: record.mcp.into_iter().map(Into::into).collect(),
		logo_url,
	})
}

fn parse_catalog(raw: &str) -> anyhow::Result<Vec<Item>> {
	let file: CatalogFile =
		serde_json::from_str(raw).context("parsing plugin catalog feed")?;
	Ok(file.plugins.into_iter().filter_map(parse_item).collect())
}

#[derive(Debug, PartialEq)]
pub enum CatalogStatus {
	Loading,
	Ready,
	Failed(SharedString),
}

/// Network-backed plugin catalog, owned as a GPUI entity.
pub struct Catalog {
	status: CatalogStatus,
	items: Vec<Item>,
	_fetch: Option<Task<()>>,
}

impl Catalog {
	pub fn new(cx: &mut Context<Self>) -> Self {
		let mut catalog = Self {
			status: CatalogStatus::Loading,
			items: Vec::new(),
			_fetch: None,
		};
		catalog.reload(cx);
		catalog
	}

	pub fn reload(&mut self, cx: &mut Context<Self>) {
		self.status = CatalogStatus::Loading;
		let client = cx.http_client();
		let task = cx.spawn(async move |this, cx| {
			let result = fetch_items(client).await;
			this.update(cx, |catalog, cx| {
				match result {
					Ok(items) => {
						catalog.items = items;
						catalog.status = CatalogStatus::Ready;
					}
					Err(error) => {
						catalog.status =
							CatalogStatus::Failed(format!("{error:#}").into());
					}
				}
				cx.notify();
			})
			.ok();
		});
		self._fetch = Some(task);
	}

	pub fn is_loading(&self) -> bool {
		matches!(self.status, CatalogStatus::Loading)
	}

	pub fn error(&self) -> Option<&SharedString> {
		match &self.status {
			CatalogStatus::Failed(message) => Some(message),
			_ => None,
		}
	}

	pub fn find(&self, id: &str) -> Option<&Item> {
		self.items.iter().find(|item| item.id.as_ref() == id)
	}

	pub fn visible(&self, category: Category, query: &str) -> Vec<Item> {
		self.items
			.iter()
			.filter(|item| category.contains(item) && item.matches(query))
			.cloned()
			.collect()
	}
}

async fn fetch_items(client: Arc<dyn HttpClient>) -> anyhow::Result<Vec<Item>> {
	let mut response = client
		.get(CATALOG_URL, ().into(), true)
		.await
		.context("requesting plugin catalog")?;
	let status = response.status();
	if !status.is_success() {
		anyhow::bail!("plugin catalog request failed: {status}");
	}
	let mut body = Vec::new();
	response
		.body_mut()
		.read_to_end(&mut body)
		.await
		.context("reading plugin catalog body")?;
	parse_catalog(&String::from_utf8_lossy(&body))
}

#[cfg(test)]
mod tests {
	use super::*;

	const SAMPLE: &str = r#"{
		"plugins": [
			{
				"name": "advisor",
				"path": "advisor",
				"version": "1.0.0",
				"description": "Consult a stronger model at key checkpoints.",
				"author": { "name": "Cursor" },
				"homepage": "https://example.com/advisor",
				"repository": "https://example.com/repo",
				"license": "MIT",
				"keywords": ["advisor", "review"],
				"displayName": "Advisor",
				"logo": "assets/avatar.png",
				"category": "Developer tools",
				"skills": ["advisor"],
				"mcpServers": []
			},
			{
				"name": "attio",
				"path": "attio",
				"version": "1.0.0",
				"description": "CRM integration for sales teams.",
				"author": { "name": "Cursor" },
				"homepage": "https://example.com/attio",
				"repository": "https://example.com/repo",
				"license": "MIT",
				"keywords": [],
				"displayName": "Attio",
				"category": "Integrations",
				"skills": [],
				"mcpServers": ["attio"]
			},
			{
				"name": "weird",
				"path": "weird",
				"description": "Entry with a category the app does not know.",
				"author": { "name": "Nobody" },
				"homepage": "https://example.com/weird",
				"repository": "https://example.com/repo",
				"license": "MIT",
				"keywords": [],
				"displayName": "Weird",
				"category": "Quantum",
				"skills": [],
				"mcpServers": []
			}
		]
	}"#;

	fn items() -> Vec<Item> {
		parse_catalog(SAMPLE).expect("sample parses")
	}

	#[test]
	fn unknown_categories_are_skipped() {
		let items = items();
		assert_eq!(items.len(), 2);
		assert!(items.iter().all(|item| item.id() != "weird"));
	}

	#[test]
	fn records_map_every_displayed_field() {
		let advisor = items()
			.into_iter()
			.find(|item| item.id() == "advisor")
			.unwrap();
		assert_eq!(advisor.name().as_ref(), "Advisor");
		assert_eq!(advisor.path().as_ref(), "advisor");
		assert_eq!(advisor.category(), Category::DeveloperTools);
		assert_eq!(advisor.author().as_ref(), "Cursor");
		assert_eq!(advisor.version().as_ref(), "1.0.0");
		assert_eq!(advisor.license().as_ref(), "MIT");
		assert_eq!(advisor.homepage().as_ref(), "https://example.com/advisor");
		assert_eq!(
			advisor.keywords().to_vec(),
			vec![SharedString::from("advisor"), SharedString::from("review")]
		);
		assert_eq!(
			advisor.skills().to_vec(),
			vec![SharedString::from("advisor")]
		);
		assert_eq!(
			advisor.logo_url().cloned(),
			Some(SharedString::from(
				"https://raw.githubusercontent.com/aghub-app/agent-plugin-awesome/main/out/advisor/assets/avatar.png"
			))
		);
	}

	#[test]
	fn missing_logo_yields_no_logo_url() {
		let attio = items()
			.into_iter()
			.find(|item| item.id() == "attio")
			.unwrap();
		assert_eq!(attio.logo_url(), None);
		assert_eq!(attio.mcp().to_vec(), vec![SharedString::from("attio")]);
	}

	#[test]
	fn matches_name_description_author_and_mcp() {
		let items = items();
		let advisor = items.iter().find(|item| item.id() == "advisor").unwrap();
		assert!(advisor.matches(""));
		assert!(advisor.matches("  "));
		assert!(advisor.matches("ADVIS"));
		assert!(advisor.matches("checkpoints"));
		assert!(advisor.matches("cursor"));
		assert!(advisor.matches("review"));
		assert!(!advisor.matches("zzzz-no-match"));
		let attio = items.iter().find(|item| item.id() == "attio").unwrap();
		assert!(attio.matches("attio"));
	}

	#[test]
	fn malformed_feed_is_an_error() {
		assert!(parse_catalog("{").is_err());
	}
}

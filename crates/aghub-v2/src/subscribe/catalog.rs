use std::sync::OnceLock;

use gpui_kit::SharedString;
use serde::Deserialize;

const CATALOG_JSON: &str = include_str!("../../assets/cursor-plugins.json");

#[derive(Clone, Copy, PartialEq, Eq)]
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

	fn from_slug(slug: &str) -> Option<Self> {
		match slug {
			"utilities" => Some(Self::Utilities),
			"developer-tools" => Some(Self::DeveloperTools),
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
struct PluginRecord {
	name: String,
	#[serde(rename = "displayName")]
	display_name: String,
	description: String,
	category: String,
	#[serde(default)]
	path: String,
	#[serde(default)]
	skills: Vec<SkillRecord>,
	#[serde(default)]
	mcp: Vec<McpRecord>,
}

#[derive(Deserialize)]
struct SkillRecord {
	name: String,
	#[serde(default)]
	description: String,
	path: String,
}

#[derive(Deserialize)]
struct McpRecord {
	name: String,
	path: String,
	url: Option<String>,
}

#[derive(Clone)]
pub struct Skill {
	name: SharedString,
	description: SharedString,
	path: SharedString,
}

impl Skill {
	pub fn name(&self) -> &SharedString {
		&self.name
	}

	pub fn description(&self) -> &SharedString {
		&self.description
	}

	pub fn source_url(&self) -> String {
		github_blob(&self.path)
	}
}

#[derive(Clone)]
pub struct McpServer {
	name: SharedString,
	url: Option<SharedString>,
	path: SharedString,
}

impl McpServer {
	pub fn name(&self) -> &SharedString {
		&self.name
	}

	pub fn url(&self) -> Option<&SharedString> {
		self.url.as_ref()
	}

	pub fn source_url(&self) -> String {
		github_blob(&self.path)
	}
}

#[derive(Clone)]
pub struct Item {
	pub(super) id: SharedString,
	pub(super) name: SharedString,
	pub(super) category: Category,
	pub(super) description: SharedString,
	path: SharedString,
	skills: Vec<Skill>,
	mcp: Vec<McpServer>,
}

fn github_blob(path: &str) -> String {
	format!("https://github.com/cursor/plugins/blob/main/{path}")
}

pub fn catalog() -> &'static [Item] {
	static CATALOG: OnceLock<Vec<Item>> = OnceLock::new();
	CATALOG.get_or_init(|| {
		parse_catalog(CATALOG_JSON).expect("cursor plugin catalog")
	})
}

pub fn item(id: impl AsRef<str>) -> Option<&'static Item> {
	let id = id.as_ref();
	catalog().iter().find(|item| item.id.as_ref() == id)
}

impl Item {
	pub fn name(&self) -> &SharedString {
		&self.name
	}

	pub fn description(&self) -> &SharedString {
		&self.description
	}

	pub fn category(&self) -> Category {
		self.category
	}

	pub fn source_url(&self) -> String {
		format!(
			"https://github.com/cursor/plugins/tree/main/{}",
			self.path.as_ref()
		)
	}

	pub fn skills(&self) -> &[Skill] {
		&self.skills
	}

	pub fn mcp(&self) -> &[McpServer] {
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
			|| self.skills.iter().any(|skill| {
				skill.name.as_ref().to_lowercase().contains(&query)
					|| skill
						.description
						.as_ref()
						.to_lowercase()
						.contains(&query)
			}) || self
			.mcp
			.iter()
			.any(|server| server.name.as_ref().to_lowercase().contains(&query))
	}
}

fn parse_catalog(raw: &str) -> Result<Vec<Item>, String> {
	let records: Vec<PluginRecord> =
		serde_json::from_str(raw).map_err(|error| error.to_string())?;
	records
		.into_iter()
		.map(|record| {
			let category =
				Category::from_slug(&record.category).ok_or_else(|| {
					format!(
						"unknown category {} for {}",
						record.category, record.name
					)
				})?;
			let path = if record.path.is_empty() {
				record.name.clone()
			} else {
				record.path
			};
			Ok(Item {
				id: record.name.into(),
				name: record.display_name.into(),
				category,
				description: record.description.into(),
				path: path.into(),
				skills: record
					.skills
					.into_iter()
					.map(|skill| Skill {
						name: skill.name.into(),
						description: skill.description.into(),
						path: skill.path.into(),
					})
					.collect(),
				mcp: record
					.mcp
					.into_iter()
					.map(|server| McpServer {
						name: server.name.into(),
						url: server.url.map(Into::into),
						path: server.path.into(),
					})
					.collect(),
			})
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn catalog_parses_with_known_categories_and_unique_ids() {
		let items = parse_catalog(CATALOG_JSON).expect("catalog parses");
		assert!(!items.is_empty());
		let mut ids: Vec<&str> =
			items.iter().map(|item| item.id.as_ref()).collect();
		let count = ids.len();
		ids.sort_unstable();
		ids.dedup();
		assert_eq!(ids.len(), count);
	}

	#[test]
	fn unknown_category_is_rejected() {
		let raw = r#"[{
			"name": "demo",
			"displayName": "Demo",
			"description": "x",
			"category": "not-a-category"
		}]"#;
		assert!(parse_catalog(raw).is_err());
	}

	#[test]
	fn item_finds_catalog_entry_by_id() {
		let found = item("teaching").expect("teaching plugin");
		assert_eq!(found.name.as_ref(), "Teaching");
		assert!(item("not-a-plugin").is_none());
	}

	#[test]
	fn source_url_points_at_the_plugin_tree() {
		let found = item("advisor").expect("advisor plugin");
		assert_eq!(
			found.source_url(),
			"https://github.com/cursor/plugins/tree/main/advisor"
		);
		let attio = item("attio").expect("attio plugin");
		assert_eq!(
			attio.source_url(),
			"https://github.com/cursor/plugins/tree/main/third_party/attio"
		);
	}

	#[test]
	fn matches_name_description_and_mcp() {
		let advisor = item("advisor").expect("advisor plugin");
		assert!(advisor.matches(""));
		assert!(advisor.matches("  "));
		assert!(advisor.matches("ADVIS"));
		assert!(advisor.matches("consult"));
		assert!(!advisor.matches("zzzz-no-match"));
		let attio = item("attio").expect("attio plugin");
		assert!(attio.matches("attio"));
	}

	#[test]
	fn catalog_includes_skills_and_mcp() {
		let advisor = item("advisor").expect("advisor plugin");
		assert!(!advisor.skills().is_empty());
		assert!(advisor.mcp().is_empty());
		let attio = item("attio").expect("attio plugin");
		assert!(attio.skills().is_empty());
		assert_eq!(attio.mcp()[0].name().as_ref(), "attio");
	}
}

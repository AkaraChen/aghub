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
}

#[derive(Clone)]
pub struct Item {
	pub(super) id: SharedString,
	pub(super) name: SharedString,
	pub(super) category: Category,
	pub(super) description: SharedString,
}

pub fn catalog() -> &'static [Item] {
	static CATALOG: OnceLock<Vec<Item>> = OnceLock::new();
	CATALOG.get_or_init(|| {
		parse_catalog(CATALOG_JSON).expect("cursor plugin catalog")
	})
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
			Ok(Item {
				id: record.name.into(),
				name: record.display_name.into(),
				category,
				description: record.description.into(),
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
}

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct MarketSkill {
	pub name: String,
	pub slug: String,
	pub source: String,
	pub installs: u64,
	pub author: Option<String>,
}

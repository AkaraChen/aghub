pub mod git;
mod lifecycle;
mod marketplace;
mod marketplace_ops;
pub mod registry;

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

pub struct PluginInstaller {
	marketplace_root: PathBuf,
	marketplace_urls: RwLock<HashMap<String, HashMap<String, String>>>,
}

impl PluginInstaller {
	pub fn new() -> Result<Self> {
		let home = dirs::home_dir().context("Cannot find home directory")?;
		let marketplace_root =
			home.join(".claude/plugins/marketplaces/claude-plugins-official");

		Ok(Self {
			marketplace_root,
			marketplace_urls: RwLock::new(HashMap::new()),
		})
	}
}

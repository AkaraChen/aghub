use serde::{Deserialize, Serialize};

use crate::Prompt;

pub const PROMPT_BACKUP_FORMAT: &str = "aghub-prompts";
pub const PROMPT_BACKUP_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PromptBackup {
	pub format: String,
	pub version: u32,
	pub exported_at: u64,
	pub prompts: Vec<Prompt>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptImportMode {
	Merge,
	Replace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromptImportResult {
	pub added: usize,
	pub updated: usize,
	pub unchanged: usize,
	pub removed: usize,
	pub total: usize,
}

use aghub_prompt::{
	extract_variables, NewPrompt, Prompt, PromptBackup, PromptImportMode,
	PromptImportResult, PromptUpdate,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PromptResponse {
	pub id: String,
	pub title: String,
	pub description: Option<String>,
	pub category: Option<String>,
	pub content: String,
	pub tags: Vec<String>,
	/// `{{ variable }}` names found in the content, derived on read.
	pub variables: Vec<String>,
	pub created_at: u64,
	pub updated_at: u64,
}

impl From<Prompt> for PromptResponse {
	fn from(prompt: Prompt) -> Self {
		let variables = extract_variables(&prompt.content);
		Self {
			id: prompt.id,
			title: prompt.title,
			description: prompt.description,
			category: prompt.category,
			content: prompt.content,
			tags: prompt.tags,
			variables,
			created_at: prompt.created_at,
			updated_at: prompt.updated_at,
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreatePromptRequest {
	pub title: String,
	pub description: Option<String>,
	pub category: Option<String>,
	pub content: String,
	pub tags: Option<Vec<String>>,
}

impl From<CreatePromptRequest> for NewPrompt {
	fn from(req: CreatePromptRequest) -> Self {
		Self {
			title: req.title,
			description: req.description,
			category: req.category,
			content: req.content,
			tags: req.tags.unwrap_or_default(),
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdatePromptRequest {
	pub title: Option<String>,
	pub description: Option<String>,
	pub category: Option<String>,
	pub content: Option<String>,
	pub tags: Option<Vec<String>>,
}

impl From<UpdatePromptRequest> for PromptUpdate {
	fn from(req: UpdatePromptRequest) -> Self {
		Self {
			title: req.title,
			description: req.description,
			category: req.category,
			content: req.content,
			tags: req.tags,
		}
	}
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PromptBackupItemDto {
	pub id: String,
	pub title: String,
	pub description: Option<String>,
	pub category: Option<String>,
	pub content: String,
	pub tags: Vec<String>,
	pub created_at: u64,
	pub updated_at: u64,
}

impl From<Prompt> for PromptBackupItemDto {
	fn from(prompt: Prompt) -> Self {
		Self {
			id: prompt.id,
			title: prompt.title,
			description: prompt.description,
			category: prompt.category,
			content: prompt.content,
			tags: prompt.tags,
			created_at: prompt.created_at,
			updated_at: prompt.updated_at,
		}
	}
}

impl From<PromptBackupItemDto> for Prompt {
	fn from(prompt: PromptBackupItemDto) -> Self {
		Self {
			id: prompt.id,
			title: prompt.title,
			description: prompt.description,
			category: prompt.category,
			content: prompt.content,
			tags: prompt.tags,
			created_at: prompt.created_at,
			updated_at: prompt.updated_at,
		}
	}
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PromptBackupDto {
	pub format: String,
	pub version: u32,
	pub exported_at: u64,
	pub prompts: Vec<PromptBackupItemDto>,
}

impl From<PromptBackup> for PromptBackupDto {
	fn from(backup: PromptBackup) -> Self {
		Self {
			format: backup.format,
			version: backup.version,
			exported_at: backup.exported_at,
			prompts: backup
				.prompts
				.into_iter()
				.map(PromptBackupItemDto::from)
				.collect(),
		}
	}
}

impl From<PromptBackupDto> for PromptBackup {
	fn from(backup: PromptBackupDto) -> Self {
		Self {
			format: backup.format,
			version: backup.version,
			exported_at: backup.exported_at,
			prompts: backup.prompts.into_iter().map(Prompt::from).collect(),
		}
	}
}

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum PromptImportModeDto {
	Merge,
	Replace,
}

impl From<PromptImportModeDto> for PromptImportMode {
	fn from(mode: PromptImportModeDto) -> Self {
		match mode {
			PromptImportModeDto::Merge => Self::Merge,
			PromptImportModeDto::Replace => Self::Replace,
		}
	}
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct ImportPromptBackupRequest {
	pub backup: PromptBackupDto,
	pub mode: PromptImportModeDto,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PromptImportResultResponse {
	pub added: usize,
	pub updated: usize,
	pub unchanged: usize,
	pub removed: usize,
	pub total: usize,
}

impl From<PromptImportResult> for PromptImportResultResponse {
	fn from(result: PromptImportResult) -> Self {
		Self {
			added: result.added,
			updated: result.updated,
			unchanged: result.unchanged,
			removed: result.removed,
			total: result.total,
		}
	}
}

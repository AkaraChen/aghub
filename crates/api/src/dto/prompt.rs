use aghub_prompt::{extract_variables, NewPrompt, Prompt, PromptUpdate};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PromptResponse {
	pub id: String,
	pub title: String,
	pub description: Option<String>,
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
	pub content: String,
	pub tags: Option<Vec<String>>,
}

impl From<CreatePromptRequest> for NewPrompt {
	fn from(req: CreatePromptRequest) -> Self {
		Self {
			title: req.title,
			description: req.description,
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
	pub content: Option<String>,
	pub tags: Option<Vec<String>>,
}

impl From<UpdatePromptRequest> for PromptUpdate {
	fn from(req: UpdatePromptRequest) -> Self {
		Self {
			title: req.title,
			description: req.description,
			content: req.content,
			tags: req.tags,
		}
	}
}

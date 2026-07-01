use serde::{Deserialize, Serialize};

/// A stored prompt in the local library.
///
/// Timestamps are Unix milliseconds; the frontend formats them for display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Prompt {
	pub id: String,
	pub title: String,
	#[serde(default)]
	pub description: Option<String>,
	pub content: String,
	#[serde(default)]
	pub tags: Vec<String>,
	pub created_at: u64,
	pub updated_at: u64,
}

/// Input for creating a prompt. The store assigns id and timestamps.
#[derive(Debug, Clone, Default)]
pub struct NewPrompt {
	pub title: String,
	pub description: Option<String>,
	pub content: String,
	pub tags: Vec<String>,
}

/// Partial update for a prompt. `None` fields are left unchanged.
#[derive(Debug, Clone, Default)]
pub struct PromptUpdate {
	pub title: Option<String>,
	pub description: Option<String>,
	pub content: Option<String>,
	pub tags: Option<Vec<String>>,
}

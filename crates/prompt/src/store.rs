//! JSON-file-backed storage for the local prompt library.
//!
//! All prompts live in a single `prompts.json` array under the app data
//! directory. Mutations rewrite the file atomically (temp file + rename).
//! Concurrent read-modify-write is the caller's responsibility — the API
//! layer serializes mutations with a lock.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{PromptError, Result};
use crate::model::{NewPrompt, Prompt, PromptUpdate};

/// File name holding the prompt array under the app data directory.
pub const PROMPTS_FILE: &str = "prompts.json";

/// Prompt library rooted at an app data directory.
#[derive(Debug, Clone)]
pub struct PromptStore {
	dir: PathBuf,
}

impl PromptStore {
	pub fn new(app_data_dir: impl Into<PathBuf>) -> Self {
		Self {
			dir: app_data_dir.into(),
		}
	}

	pub fn file_path(&self) -> PathBuf {
		self.dir.join(PROMPTS_FILE)
	}

	/// List all prompts. A missing file reads as an empty library.
	pub fn list(&self) -> Result<Vec<Prompt>> {
		match std::fs::read_to_string(self.file_path()) {
			Ok(content) => Ok(serde_json::from_str(&content)?),
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
				Ok(Vec::new())
			}
			Err(error) => Err(error.into()),
		}
	}

	pub fn get(&self, id: &str) -> Result<Prompt> {
		self.list()?
			.into_iter()
			.find(|prompt| prompt.id == id)
			.ok_or_else(|| PromptError::NotFound(id.to_string()))
	}

	pub fn create(&self, input: NewPrompt) -> Result<Prompt> {
		let now = now_millis();
		let prompt = Prompt {
			id: uuid::Uuid::new_v4().to_string(),
			title: clean_title(&input.title)?,
			description: clean_description(input.description),
			content: input.content,
			tags: clean_tags(input.tags),
			created_at: now,
			updated_at: now,
		};

		let mut prompts = self.list()?;
		prompts.push(prompt.clone());
		self.write(&prompts)?;
		Ok(prompt)
	}

	pub fn update(&self, id: &str, input: PromptUpdate) -> Result<Prompt> {
		let mut prompts = self.list()?;
		let index = prompts
			.iter()
			.position(|prompt| prompt.id == id)
			.ok_or_else(|| PromptError::NotFound(id.to_string()))?;

		let mut prompt = prompts[index].clone();
		if let Some(title) = input.title {
			prompt.title = clean_title(&title)?;
		}
		if let Some(description) = input.description {
			prompt.description = clean_description(Some(description));
		}
		if let Some(content) = input.content {
			prompt.content = content;
		}
		if let Some(tags) = input.tags {
			prompt.tags = clean_tags(tags);
		}
		prompt.updated_at = now_millis();

		prompts[index] = prompt.clone();
		self.write(&prompts)?;
		Ok(prompt)
	}

	pub fn delete(&self, id: &str) -> Result<Prompt> {
		let mut prompts = self.list()?;
		let index = prompts
			.iter()
			.position(|prompt| prompt.id == id)
			.ok_or_else(|| PromptError::NotFound(id.to_string()))?;
		let removed = prompts.remove(index);
		self.write(&prompts)?;
		Ok(removed)
	}

	fn write(&self, prompts: &[Prompt]) -> Result<()> {
		std::fs::create_dir_all(&self.dir)?;
		let json = serde_json::to_string_pretty(prompts)?;
		let tmp = self.dir.join(format!("{PROMPTS_FILE}.tmp"));
		std::fs::write(&tmp, json)?;
		std::fs::rename(&tmp, self.file_path())?;
		Ok(())
	}
}

fn now_millis() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|elapsed| elapsed.as_millis() as u64)
		.unwrap_or(0)
}

fn clean_title(title: &str) -> Result<String> {
	let title = title.trim();
	if title.is_empty() {
		Err(PromptError::EmptyTitle)
	} else {
		Ok(title.to_string())
	}
}

fn clean_description(description: Option<String>) -> Option<String> {
	description.and_then(|value| {
		let value = value.trim();
		if value.is_empty() {
			None
		} else {
			Some(value.to_string())
		}
	})
}

fn clean_tags(tags: Vec<String>) -> Vec<String> {
	let mut clean = Vec::new();
	for tag in tags {
		let tag = tag.trim();
		if !tag.is_empty() && !clean.iter().any(|seen: &String| seen == tag) {
			clean.push(tag.to_string());
		}
	}
	clean
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::model::{NewPrompt, PromptUpdate};

	fn store() -> (tempfile::TempDir, PromptStore) {
		let temp = tempfile::tempdir().unwrap();
		let store = PromptStore::new(temp.path());
		(temp, store)
	}

	fn new_prompt(title: &str) -> NewPrompt {
		NewPrompt {
			title: title.to_string(),
			description: Some("  desc  ".to_string()),
			content: "Hello {{ name }}".to_string(),
			tags: vec!["a".to_string(), " a ".to_string(), "".to_string()],
		}
	}

	#[test]
	fn list_missing_file_is_empty() {
		let (_temp, store) = store();
		assert!(store.list().unwrap().is_empty());
	}

	#[test]
	fn create_normalizes_and_persists() {
		let (_temp, store) = store();
		let prompt = store.create(new_prompt("Greeting")).unwrap();

		assert_eq!(prompt.title, "Greeting");
		assert_eq!(prompt.description.as_deref(), Some("desc"));
		assert_eq!(prompt.tags, vec!["a".to_string()]);
		assert_eq!(store.get(&prompt.id).unwrap(), prompt);
		assert_eq!(store.list().unwrap().len(), 1);
	}

	#[test]
	fn empty_title_is_rejected() {
		let (_temp, store) = store();
		let error = store
			.create(NewPrompt {
				title: "   ".to_string(),
				..Default::default()
			})
			.unwrap_err();
		assert!(matches!(error, PromptError::EmptyTitle));
	}

	#[test]
	fn update_changes_only_provided_fields() {
		let (_temp, store) = store();
		let prompt = store.create(new_prompt("Greeting")).unwrap();

		let updated = store
			.update(
				&prompt.id,
				PromptUpdate {
					content: Some("Bye {{ name }}".to_string()),
					..Default::default()
				},
			)
			.unwrap();

		assert_eq!(updated.title, "Greeting");
		assert_eq!(updated.content, "Bye {{ name }}");
		assert!(updated.updated_at >= prompt.updated_at);
		assert_eq!(updated.created_at, prompt.created_at);
	}

	#[test]
	fn update_clears_description_with_empty_string() {
		let (_temp, store) = store();
		let prompt = store.create(new_prompt("Greeting")).unwrap();
		assert_eq!(prompt.description.as_deref(), Some("desc"));

		let updated = store
			.update(
				&prompt.id,
				PromptUpdate {
					description: Some(String::new()),
					..Default::default()
				},
			)
			.unwrap();
		assert_eq!(updated.description, None);
	}

	#[test]
	fn update_and_delete_missing_id_errors() {
		let (_temp, store) = store();
		assert!(matches!(
			store.update("nope", PromptUpdate::default()).unwrap_err(),
			PromptError::NotFound(_)
		));
		assert!(matches!(
			store.delete("nope").unwrap_err(),
			PromptError::NotFound(_)
		));
	}

	#[test]
	fn delete_removes_prompt() {
		let (_temp, store) = store();
		let prompt = store.create(new_prompt("Greeting")).unwrap();
		let removed = store.delete(&prompt.id).unwrap();
		assert_eq!(removed.id, prompt.id);
		assert!(store.list().unwrap().is_empty());
	}
}

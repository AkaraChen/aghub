//! JSON-file-backed storage for the local prompt library.
//!
//! All prompts live in a single `prompts.json` array under the app data
//! directory. Mutations rewrite the file atomically (temp file + rename).

use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{PromptError, Result};
use crate::model::{NewPrompt, Prompt, PromptUpdate};
use crate::{
	PromptBackup, PromptImportMode, PromptImportResult, PROMPT_BACKUP_FORMAT,
	PROMPT_BACKUP_VERSION,
};

/// File name holding the prompt array under the app data directory.
const PROMPTS_FILE: &str = "prompts.json";

fn prompt_mutation_lock() -> &'static Mutex<()> {
	static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
	LOCK.get_or_init(|| Mutex::new(()))
}

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

	fn file_path(&self) -> PathBuf {
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
			category: clean_category(input.category),
			content: input.content,
			tags: clean_tags(input.tags),
			created_at: now,
			updated_at: now,
		};

		self.mutate_prompts(|prompts| {
			prompts.push(prompt.clone());
			Ok(prompt)
		})
	}

	pub fn update(&self, id: &str, input: PromptUpdate) -> Result<Prompt> {
		self.mutate_prompts(|prompts| {
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
			if let Some(category) = input.category {
				prompt.category = clean_category(Some(category));
			}
			if let Some(content) = input.content {
				prompt.content = content;
			}
			if let Some(tags) = input.tags {
				prompt.tags = clean_tags(tags);
			}
			prompt.updated_at = now_millis();

			prompts[index] = prompt.clone();
			Ok(prompt)
		})
	}

	pub fn delete(&self, id: &str) -> Result<Prompt> {
		self.mutate_prompts(|prompts| {
			let index = prompts
				.iter()
				.position(|prompt| prompt.id == id)
				.ok_or_else(|| PromptError::NotFound(id.to_string()))?;
			Ok(prompts.remove(index))
		})
	}

	pub fn export_backup(&self) -> Result<PromptBackup> {
		Ok(PromptBackup {
			format: PROMPT_BACKUP_FORMAT.to_string(),
			version: PROMPT_BACKUP_VERSION,
			exported_at: now_millis(),
			prompts: self.list()?,
		})
	}

	pub fn import_backup(
		&self,
		backup: PromptBackup,
		mode: PromptImportMode,
	) -> Result<PromptImportResult> {
		let imported = validate_backup(backup)?;
		self.mutate_prompts(|prompts| {
			let original_ids = prompts
				.iter()
				.map(|prompt| prompt.id.as_str())
				.collect::<HashSet<_>>();
			let imported_ids = imported
				.iter()
				.map(|prompt| prompt.id.as_str())
				.collect::<HashSet<_>>();
			let removed = if mode == PromptImportMode::Replace {
				original_ids.difference(&imported_ids).count()
			} else {
				0
			};
			let mut result = PromptImportResult {
				added: 0,
				updated: 0,
				unchanged: 0,
				removed,
				total: 0,
			};

			if mode == PromptImportMode::Replace {
				for prompt in &imported {
					match prompts.iter().find(|current| current.id == prompt.id)
					{
						Some(current) if current == prompt => {
							result.unchanged += 1
						}
						Some(_) => result.updated += 1,
						None => result.added += 1,
					}
				}
				*prompts = imported;
			} else {
				for prompt in imported {
					match prompts
						.iter()
						.position(|current| current.id == prompt.id)
					{
						Some(index) if prompts[index] == prompt => {
							result.unchanged += 1;
						}
						Some(index) => {
							prompts[index] = prompt;
							result.updated += 1;
						}
						None => {
							prompts.push(prompt);
							result.added += 1;
						}
					}
				}
			}
			result.total = prompts.len();
			Ok(result)
		})
	}

	fn mutate_prompts<T>(
		&self,
		mutation: impl FnOnce(&mut Vec<Prompt>) -> Result<T>,
	) -> Result<T> {
		let _guard = prompt_mutation_lock().lock().map_err(|_| {
			std::io::Error::other("prompt mutation lock poisoned")
		})?;
		let mut prompts = self.list()?;
		let result = mutation(&mut prompts)?;
		self.write(&prompts)?;
		Ok(result)
	}

	fn write(&self, prompts: &[Prompt]) -> Result<()> {
		std::fs::create_dir_all(&self.dir)?;
		let path = self.file_path();
		let existing_permissions = match path.metadata() {
			Ok(metadata) => Some(metadata.permissions()),
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
			Err(error) => return Err(error.into()),
		};
		let json = serde_json::to_string_pretty(prompts)?;
		let mut temporary_builder = tempfile::Builder::new();
		temporary_builder.prefix(".prompts.").suffix(".json.tmp");
		#[cfg(unix)]
		if existing_permissions.is_none() {
			use std::os::unix::fs::PermissionsExt;
			temporary_builder
				.permissions(std::fs::Permissions::from_mode(0o666));
		}
		let mut temporary = temporary_builder.tempfile_in(&self.dir)?;
		temporary.write_all(json.as_bytes())?;
		if let Some(permissions) = existing_permissions {
			temporary.as_file().set_permissions(permissions)?;
		}
		temporary.persist(path).map_err(|error| error.error)?;
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

fn clean_category(category: Option<String>) -> Option<String> {
	clean_description(category)
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

fn validate_backup(backup: PromptBackup) -> Result<Vec<Prompt>> {
	if backup.format != PROMPT_BACKUP_FORMAT {
		return Err(PromptError::InvalidBackup(format!(
			"expected format '{PROMPT_BACKUP_FORMAT}'"
		)));
	}
	if backup.version != PROMPT_BACKUP_VERSION {
		return Err(PromptError::UnsupportedBackupVersion(backup.version));
	}

	let mut ids = HashSet::new();
	let mut prompts = Vec::with_capacity(backup.prompts.len());
	for mut prompt in backup.prompts {
		prompt.id = prompt.id.trim().to_string();
		if prompt.id.is_empty() {
			return Err(PromptError::InvalidBackup(
				"prompt id cannot be empty".to_string(),
			));
		}
		if !ids.insert(prompt.id.clone()) {
			return Err(PromptError::InvalidBackup(format!(
				"duplicate prompt id '{}'",
				prompt.id
			)));
		}
		prompt.title = clean_title(&prompt.title)?;
		prompt.description = clean_description(prompt.description);
		prompt.category = clean_category(prompt.category);
		prompt.tags = clean_tags(prompt.tags);
		prompts.push(prompt);
	}
	Ok(prompts)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::model::{NewPrompt, PromptUpdate};
	use crate::{
		PromptImportMode, PROMPT_BACKUP_FORMAT, PROMPT_BACKUP_VERSION,
	};

	fn store() -> (tempfile::TempDir, PromptStore) {
		let temp = tempfile::tempdir().unwrap();
		let store = PromptStore::new(temp.path());
		(temp, store)
	}

	fn new_prompt(title: &str) -> NewPrompt {
		NewPrompt {
			title: title.to_string(),
			description: Some("  desc  ".to_string()),
			category: Some("  Work  ".to_string()),
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
		assert_eq!(prompt.category.as_deref(), Some("Work"));
		assert_eq!(prompt.tags, vec!["a".to_string()]);
		assert_eq!(store.get(&prompt.id).unwrap(), prompt);
		assert_eq!(store.list().unwrap().len(), 1);
	}

	#[test]
	fn exports_a_versioned_backup() {
		let (_temp, store) = store();
		store.create(new_prompt("Greeting")).unwrap();

		let backup = store.export_backup().unwrap();

		assert_eq!(backup.format, PROMPT_BACKUP_FORMAT);
		assert_eq!(backup.version, PROMPT_BACKUP_VERSION);
		assert_eq!(backup.prompts.len(), 1);
	}

	#[test]
	fn merge_import_updates_matching_ids_and_keeps_local_prompts() {
		let (_source_temp, source) = store();
		let imported = source.create(new_prompt("Greeting")).unwrap();
		let first_backup = source.export_backup().unwrap();

		let (_target_temp, target) = store();
		target
			.import_backup(first_backup, PromptImportMode::Replace)
			.unwrap();
		let local = target.create(new_prompt("Local only")).unwrap();

		source
			.update(
				&imported.id,
				PromptUpdate {
					content: Some("Updated backup content".to_string()),
					..Default::default()
				},
			)
			.unwrap();
		let result = target
			.import_backup(
				source.export_backup().unwrap(),
				PromptImportMode::Merge,
			)
			.unwrap();

		assert_eq!(result.added, 0);
		assert_eq!(result.updated, 1);
		assert_eq!(result.total, 2);
		assert_eq!(target.get(&local.id).unwrap(), local);
		assert_eq!(
			target.get(&imported.id).unwrap().content,
			"Updated backup content"
		);
	}

	#[test]
	fn replace_import_removes_prompts_missing_from_backup() {
		let (_source_temp, source) = store();
		let imported = source.create(new_prompt("Imported")).unwrap();
		let backup = source.export_backup().unwrap();

		let (_target_temp, target) = store();
		target.create(new_prompt("Local only")).unwrap();
		let result = target
			.import_backup(backup, PromptImportMode::Replace)
			.unwrap();

		assert_eq!(result.added, 1);
		assert_eq!(result.removed, 1);
		assert_eq!(result.total, 1);
		assert_eq!(target.list().unwrap(), vec![imported]);
	}

	#[test]
	fn invalid_backup_does_not_change_the_library() {
		let (_temp, store) = store();
		let local = store.create(new_prompt("Local")).unwrap();
		let mut backup = store.export_backup().unwrap();
		backup.prompts.push(local.clone());

		let error = store
			.import_backup(backup, PromptImportMode::Replace)
			.unwrap_err();

		assert!(matches!(error, PromptError::InvalidBackup(_)));
		assert_eq!(store.list().unwrap(), vec![local]);
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

	#[test]
	fn concurrent_updates_preserve_every_prompt() {
		const WRITER_COUNT: usize = 32;

		let (temp, store) = store();
		let prompts = (0..WRITER_COUNT)
			.map(|index| {
				store
					.create(new_prompt(&format!("Prompt {index}")))
					.unwrap()
			})
			.collect::<Vec<_>>();
		let barrier =
			std::sync::Arc::new(std::sync::Barrier::new(WRITER_COUNT));
		let mut writers = Vec::with_capacity(WRITER_COUNT);

		for (index, prompt) in prompts.iter().enumerate() {
			let root = temp.path().to_path_buf();
			let prompt_id = prompt.id.clone();
			let barrier = barrier.clone();
			writers.push(std::thread::spawn(move || {
				barrier.wait();
				PromptStore::new(root).update(
					&prompt_id,
					PromptUpdate {
						content: Some(format!("Updated {index}")),
						..Default::default()
					},
				)
			}));
		}

		for writer in writers {
			writer.join().unwrap().unwrap();
		}

		let stored = store.list().unwrap();
		for (index, prompt) in prompts.iter().enumerate() {
			let updated =
				stored.iter().find(|stored| stored.id == prompt.id).unwrap();
			assert_eq!(updated.content, format!("Updated {index}"));
		}
	}

	#[cfg(unix)]
	#[test]
	fn update_preserves_file_permissions() {
		use std::os::unix::fs::PermissionsExt;

		let (_temp, store) = store();
		let prompt = store.create(new_prompt("Greeting")).unwrap();
		let path = store.file_path();
		std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
			.unwrap();

		store
			.update(
				&prompt.id,
				PromptUpdate {
					content: Some("Updated".to_string()),
					..Default::default()
				},
			)
			.unwrap();

		let mode = path.metadata().unwrap().permissions().mode() & 0o777;
		assert_eq!(mode, 0o600);
	}

	#[cfg(unix)]
	#[test]
	fn create_uses_normal_file_permissions() {
		use std::os::unix::fs::PermissionsExt;

		let (temp, store) = store();
		let expected = temp.path().join("expected.json");
		std::fs::write(&expected, "expected").unwrap();

		store.create(new_prompt("Greeting")).unwrap();

		let expected_mode =
			expected.metadata().unwrap().permissions().mode() & 0o777;
		let actual_mode =
			store.file_path().metadata().unwrap().permissions().mode() & 0o777;
		assert_eq!(actual_mode, expected_mode);
	}
}

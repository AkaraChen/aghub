use std::path::{Component, Path, PathBuf};

use crate::model::FileContentResponse;
use crate::scanner::{detect_file_type, resolve_agent_root};

/// Maximum file size we're willing to read (1 MB).
const MAX_FILE_SIZE: u64 = 1_048_576;

/// Read a single file from the agent's workspace.
pub fn read_file(
	agent_id: &str,
	relative_path: &str,
) -> Result<FileContentResponse, FileError> {
	let root = resolve_agent_root(agent_id)?;
	let full_path = validate_path(&root, relative_path)?;

	if full_path.is_dir() {
		return Err(FileError::IsDirectory(relative_path.to_string()));
	}

	let metadata = std::fs::metadata(&full_path)
		.map_err(|e| FileError::Io(full_path.display().to_string(), e))?;

	if metadata.len() > MAX_FILE_SIZE {
		return Err(FileError::TooLarge(
			relative_path.to_string(),
			metadata.len(),
		));
	}

	let content = std::fs::read_to_string(&full_path)
		.map_err(|e| FileError::Io(full_path.display().to_string(), e))?;

	let name = full_path
		.file_name()
		.map(|n| n.to_string_lossy().to_string())
		.unwrap_or_default();

	let file_type = detect_file_type(&name);

	Ok(FileContentResponse {
		path: relative_path.to_string(),
		name,
		file_type,
		content,
	})
}

/// Write content to a file in the agent's workspace.
pub fn write_file(
	agent_id: &str,
	relative_path: &str,
	content: &str,
) -> Result<FileContentResponse, FileError> {
	let root = resolve_agent_root(agent_id)?;
	let full_path = validate_path(&root, relative_path)?;

	if full_path.is_dir() {
		return Err(FileError::IsDirectory(relative_path.to_string()));
	}

	// Only allow writing to existing files — don't create new ones
	if !full_path.exists() {
		return Err(FileError::NotFound(relative_path.to_string()));
	}

	std::fs::write(&full_path, content)
		.map_err(|e| FileError::Io(full_path.display().to_string(), e))?;

	let name = full_path
		.file_name()
		.map(|n| n.to_string_lossy().to_string())
		.unwrap_or_default();

	let file_type = detect_file_type(&name);

	Ok(FileContentResponse {
		path: relative_path.to_string(),
		name,
		file_type,
		content: content.to_string(),
	})
}

/// Validate that a relative path stays within the agent root directory.
/// Returns the full canonical path.
fn validate_path(
	root: &Path,
	relative_path: &str,
) -> Result<PathBuf, FileError> {
	let rel = Path::new(relative_path);

	// Reject paths with parent directory components
	for component in rel.components() {
		if matches!(component, Component::ParentDir) {
			return Err(FileError::PathTraversal(relative_path.to_string()));
		}
	}

	let full_path = root.join(rel);

	// Canonicalize to resolve any symlinks, then verify containment
	let canonical_root = root
		.canonicalize()
		.map_err(|e| FileError::Io(root.display().to_string(), e))?;

	let canonical_path = full_path
		.canonicalize()
		.map_err(|_| FileError::NotFound(relative_path.to_string()))?;

	if !canonical_path.starts_with(&canonical_root) {
		return Err(FileError::PathTraversal(relative_path.to_string()));
	}

	Ok(canonical_path)
}

#[derive(Debug, thiserror::Error)]
pub enum FileError {
	#[error("File not found: {0}")]
	NotFound(String),

	#[error("Path is a directory: {0}")]
	IsDirectory(String),

	#[error("Path traversal not allowed: {0}")]
	PathTraversal(String),

	#[error("File too large: {0} ({1} bytes, max {MAX_FILE_SIZE})")]
	TooLarge(String, u64),

	#[error("IO error on '{0}': {1}")]
	Io(String, std::io::Error),

	#[error(transparent)]
	Scan(#[from] crate::scanner::ScanError),
}

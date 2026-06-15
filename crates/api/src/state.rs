use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tempfile::TempDir;

pub struct GitCloneSession {
	pub temp_dir: TempDir,
	pub created_at: Instant,
	/// The original clone URL (without credentials).
	pub url: String,
	/// Resolved credential token, if any.
	pub credential_token: Option<String>,
	/// Cached list of remote branch names.
	pub branches: Vec<String>,
	/// The branch currently checked out in this session.
	pub current_branch: String,
	/// Normalized relative skill paths returned by the scan.
	pub scanned_skill_paths: HashSet<String>,
}

pub struct GitCloneSessions {
	pub sessions: Mutex<HashMap<String, GitCloneSession>>,
}

pub struct InferenceProviderState {
	pub app_data_dir: PathBuf,
}

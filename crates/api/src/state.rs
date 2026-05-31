use std::collections::HashMap;
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
}

pub struct GitCloneSessions {
	pub sessions: Mutex<HashMap<String, GitCloneSession>>,
}

pub struct InferenceProviderState {
	pub app_data_dir: PathBuf,
}

/// Path to the bundled `ccusage` sidecar binary, injected by the desktop shell.
/// `None` in dev / standalone server: usage routes fall back to the
/// `AGHUB_CCUSAGE_BIN` env var, then to `ccusage` on `PATH`.
pub struct UsageState {
	pub ccusage_bin: Option<PathBuf>,
}

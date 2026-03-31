use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use tempfile::TempDir;

pub struct GitCloneSession {
	pub temp_dir: TempDir,
	pub created_at: Instant,
}

pub struct GitCloneSessions {
	pub sessions: Mutex<HashMap<String, GitCloneSession>>,
}

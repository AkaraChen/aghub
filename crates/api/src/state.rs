use aghub_inference::InferenceProviderStore;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tempfile::TempDir;

// Clone sessions support interactive review retries and expire with that UI flow.
pub const GIT_CLONE_SESSION_TTL: Duration = Duration::from_secs(30 * 60);
// Match the largest accepted skill selection while bounding retained clones.
pub const MAX_GIT_CLONE_SESSIONS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitCloneSessionKind {
	MarketInstall,
	GitScan,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitCloneSessionProvenance {
	pub kind: GitCloneSessionKind,
	pub source: String,
	pub reference: Option<String>,
}

pub struct GitCloneSession {
	pub temp_dir: TempDir,
	pub created_at: Instant,
	pub provenance: GitCloneSessionProvenance,
	/// Resolved credential token, if any.
	pub credential_token: Option<String>,
	/// Cached list of remote branch names.
	pub branches: Vec<String>,
	/// Normalized relative skill paths returned by the scan.
	pub scanned_skill_paths: HashSet<String>,
}

pub type GitCloneSessionLease = Arc<GitCloneSession>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitCloneSessionInsertError {
	CapacityExceeded,
}

#[derive(Clone, Default)]
pub struct GitCloneSessions {
	sessions: Arc<Mutex<HashMap<String, GitCloneSessionLease>>>,
}

impl GitCloneSessions {
	pub fn lease(&self, session_id: &str) -> Option<GitCloneSessionLease> {
		let mut sessions = self.sessions.lock().unwrap();
		if sessions.get(session_id).is_some_and(|session| {
			session.created_at.elapsed() >= GIT_CLONE_SESSION_TTL
		}) {
			let _ = sessions.remove(session_id);
			return None;
		}
		sessions.get(session_id).cloned()
	}

	pub fn insert(
		&self,
		session_id: String,
		session: GitCloneSession,
	) -> Result<(), GitCloneSessionInsertError> {
		self.insert_with_ttl(session_id, session, GIT_CLONE_SESSION_TTL)
	}

	fn insert_with_ttl(
		&self,
		session_id: String,
		session: GitCloneSession,
		ttl: Duration,
	) -> Result<(), GitCloneSessionInsertError> {
		let mut sessions = self.sessions.lock().unwrap();
		sessions.retain(|_, session| {
			session.created_at.elapsed() < GIT_CLONE_SESSION_TTL
		});
		if !sessions.contains_key(&session_id)
			&& sessions.len() >= MAX_GIT_CLONE_SESSIONS
		{
			return Err(GitCloneSessionInsertError::CapacityExceeded);
		}
		let session = Arc::new(session);
		sessions.insert(session_id.clone(), session.clone());
		drop(sessions);
		if let Ok(runtime) = tokio::runtime::Handle::try_current() {
			let sessions = self.sessions.clone();
			runtime.spawn(async move {
				tokio::time::sleep(ttl).await;
				let mut sessions = sessions.lock().unwrap();
				if sessions
					.get(&session_id)
					.is_some_and(|stored| Arc::ptr_eq(stored, &session))
				{
					let _ = sessions.remove(&session_id);
				}
			});
		}
		Ok(())
	}

	pub fn remove(&self, session_id: &str) {
		let _ = self.sessions.lock().unwrap().remove(session_id);
	}

	#[cfg(test)]
	fn active_count(&self) -> usize {
		self.sessions.lock().unwrap().len()
	}
}

pub struct InferenceProviderState {
	pub store: InferenceProviderStore,
}

pub struct UsageState {
	pub runtime: Arc<aghub_usage::runtime::CcusageRuntime>,
}

#[cfg(test)]
mod tests {
	use super::*;

	fn session(created_at: Instant) -> GitCloneSession {
		GitCloneSession {
			temp_dir: tempfile::tempdir().unwrap(),
			created_at,
			provenance: GitCloneSessionProvenance {
				kind: GitCloneSessionKind::GitScan,
				source: "https://github.com/example/skills.git".to_string(),
				reference: Some("main".to_string()),
			},
			credential_token: None,
			branches: vec!["main".to_string()],
			scanned_skill_paths: HashSet::new(),
		}
	}

	#[test]
	fn leased_session_survives_removal_from_the_map() {
		let sessions = GitCloneSessions::default();
		let session = session(Instant::now());
		let clone_path = session.temp_dir.path().to_path_buf();
		std::fs::write(clone_path.join("sentinel"), "kept alive").unwrap();
		sessions.insert("scan".to_string(), session).unwrap();

		let lease = sessions.lease("scan").unwrap();
		sessions.remove("scan");

		assert_eq!(
			std::fs::read_to_string(lease.temp_dir.path().join("sentinel"))
				.unwrap(),
			"kept alive"
		);
		assert!(sessions.lease("scan").is_none());
	}

	#[test]
	fn lease_removes_an_expired_session() {
		let sessions = GitCloneSessions::default();
		let created_at = Instant::now() - GIT_CLONE_SESSION_TTL;
		sessions
			.insert("expired".to_string(), session(created_at))
			.unwrap();

		assert!(sessions.lease("expired").is_none());
		assert_eq!(sessions.active_count(), 0);
	}

	#[test]
	fn insert_rejects_more_than_the_active_session_limit() {
		let sessions = GitCloneSessions::default();
		for index in 0..MAX_GIT_CLONE_SESSIONS {
			sessions
				.insert(index.to_string(), session(Instant::now()))
				.unwrap();
		}

		let error = sessions
			.insert("overflow".to_string(), session(Instant::now()))
			.unwrap_err();

		assert_eq!(error, GitCloneSessionInsertError::CapacityExceeded);
	}

	#[tokio::test]
	async fn inserted_session_is_removed_without_another_request() {
		let sessions = GitCloneSessions::default();
		let session = session(Instant::now());
		let clone_path = session.temp_dir.path().to_path_buf();
		sessions
			.insert_with_ttl(
				"expiring".to_string(),
				session,
				Duration::from_millis(10),
			)
			.unwrap();

		tokio::time::sleep(Duration::from_millis(30)).await;

		assert_eq!(sessions.active_count(), 0);
		assert!(!clone_path.exists());
	}
}

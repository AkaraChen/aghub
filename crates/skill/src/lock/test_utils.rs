use std::sync::Mutex;
use tempfile::TempDir;

static TEST_MUTEX: Mutex<()> = Mutex::new(());

pub struct TestLockGuard {
	old_xdg: Option<String>,
	_temp_dir: TempDir,
	_lock: std::sync::MutexGuard<'static, ()>,
}

impl TestLockGuard {
	pub fn new() -> Self {
		let lock = TEST_MUTEX.lock().unwrap();
		let temp_dir = TempDir::new().unwrap();
		let old_xdg = std::env::var("XDG_STATE_HOME").ok();
		std::env::set_var("XDG_STATE_HOME", temp_dir.path());
		Self {
			old_xdg,
			_temp_dir: temp_dir,
			_lock: lock,
		}
	}
}

impl Drop for TestLockGuard {
	fn drop(&mut self) {
		if self.old_xdg.is_some() {
			std::env::set_var("XDG_STATE_HOME", self.old_xdg.as_ref().unwrap());
		} else {
			std::env::remove_var("XDG_STATE_HOME");
		}
	}
}
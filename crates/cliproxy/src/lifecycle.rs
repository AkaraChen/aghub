//! Managed-instance process lifecycle: spawn, readiness, health, stop, and
//! adoption of an already-running instance on the same port.
//!
//! aghub only ever kills processes it spawned itself. If something already
//! answers on the instance's management endpoint with our key (previous
//! aghub run that crashed, or a user-started process), it is *adopted*:
//! reported as running, never respawned, and `stop` refuses politely.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

use crate::client::ManagementClient;
use crate::dto::{GatewayInstanceKind, GatewayInstanceStatus};
use crate::error::{GatewayError, Result};
use crate::store::GatewayInstanceRecord;

/// Suppresses the console window Windows would otherwise flash for child
/// processes of the console-less desktop app.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const READY_TIMEOUT: Duration = Duration::from_secs(15);
const READY_POLL_INTERVAL: Duration = Duration::from_millis(500);
/// How long after spawn an unanswering process still counts as `Starting`
/// rather than `Unhealthy`.
const STARTING_GRACE: Duration = Duration::from_secs(20);

struct RunningChild {
	child: tokio::process::Child,
	started_at: Instant,
}

/// Held in the API server's managed state; children are `kill_on_drop`, so
/// gateway processes die with the app even on abnormal exits.
#[derive(Default)]
pub struct GatewayRuntime {
	running: Mutex<HashMap<String, RunningChild>>,
}

impl GatewayRuntime {
	pub fn new() -> Self {
		Self::default()
	}

	/// Start (or adopt) the managed instance. Idempotent: an instance that
	/// is already running under our key is left alone.
	pub async fn start(
		&self,
		record: &GatewayInstanceRecord,
		bin: &std::path::Path,
		config_path: &std::path::Path,
		client: &ManagementClient,
	) -> Result<()> {
		let mut running = self.running.lock().await;
		if let Some(entry) = running.get_mut(&record.id) {
			if entry.child.try_wait()?.is_none() {
				return Ok(());
			}
			running.remove(&record.id);
		}
		// Adoption probe: something on this port already speaks our
		// management key — a leftover from a crashed aghub run or a
		// user-started process. Claim it instead of double-spawning.
		if client.ping().await.is_ok() {
			log::info!(
				"gateway '{}' already running at {}; adopted",
				record.name,
				record.base_url
			);
			return Ok(());
		}

		let mut command = tokio::process::Command::new(bin);
		command
			.arg("--config")
			.arg(config_path)
			.stdin(std::process::Stdio::null())
			.stdout(std::process::Stdio::null())
			.stderr(std::process::Stdio::piped())
			.kill_on_drop(true);
		#[cfg(windows)]
		{
			use std::os::windows::process::CommandExt;
			command.creation_flags(CREATE_NO_WINDOW);
		}
		let mut child = command.spawn().map_err(|error| {
			GatewayError::Process(format!(
				"failed to spawn {}: {error}{}",
				bin.display(),
				spawn_hint(bin)
			))
		})?;
		// Drain stderr into the app log: keeps the pipe from filling (which
		// would block the child) and surfaces startup errors.
		if let Some(stderr) = child.stderr.take() {
			let name = record.name.clone();
			tokio::spawn(async move {
				use tokio::io::AsyncBufReadExt;
				let mut lines = tokio::io::BufReader::new(stderr).lines();
				while let Ok(Some(line)) = lines.next_line().await {
					log::info!("cliproxy[{name}]: {line}");
				}
			});
		}

		let deadline = Instant::now() + READY_TIMEOUT;
		loop {
			if let Some(exit) = child.try_wait()? {
				return Err(GatewayError::Process(format!(
					"gateway exited during startup with {exit}; check the \
					 CLIProxyAPI log files"
				)));
			}
			if client.ping().await.is_ok() {
				break;
			}
			if Instant::now() >= deadline {
				let _ = child.kill().await;
				return Err(GatewayError::Process(format!(
					"gateway did not become ready within {}s",
					READY_TIMEOUT.as_secs()
				)));
			}
			tokio::time::sleep(READY_POLL_INTERVAL).await;
		}

		running.insert(
			record.id.clone(),
			RunningChild {
				child,
				started_at: Instant::now(),
			},
		);
		Ok(())
	}

	/// Stop the child we spawned. Adopted processes are not ours to kill.
	pub async fn stop(&self, record: &GatewayInstanceRecord) -> Result<()> {
		let mut running = self.running.lock().await;
		match running.remove(&record.id) {
			Some(mut entry) => {
				entry.child.kill().await.map_err(|error| {
					GatewayError::Process(format!(
						"failed to stop gateway: {error}"
					))
				})?;
				Ok(())
			}
			None => Err(GatewayError::Process(
				"this gateway process was not started by aghub; stop it \
				 where it was started"
					.to_string(),
			)),
		}
	}

	pub async fn status(
		&self,
		record: &GatewayInstanceRecord,
		binary_installed: bool,
		client: &ManagementClient,
	) -> GatewayInstanceStatus {
		if record.kind == GatewayInstanceKind::External {
			return if client.ping().await.is_ok() {
				GatewayInstanceStatus::Running
			} else {
				GatewayInstanceStatus::Unhealthy
			};
		}

		// Snapshot child liveness under the lock, then probe without it.
		let child_started_at = {
			let mut running = self.running.lock().await;
			match running.get_mut(&record.id) {
				Some(entry) => match entry.child.try_wait() {
					Ok(None) => Some(entry.started_at),
					Ok(Some(_)) | Err(_) => {
						running.remove(&record.id);
						None
					}
				},
				None => None,
			}
		};

		if let Some(started_at) = child_started_at {
			if client.ping().await.is_ok() {
				return GatewayInstanceStatus::Running;
			}
			return if started_at.elapsed() < STARTING_GRACE {
				GatewayInstanceStatus::Starting
			} else {
				GatewayInstanceStatus::Unhealthy
			};
		}

		if client.ping().await.is_ok() {
			// Adopted: running, but not via a child of ours.
			return GatewayInstanceStatus::Running;
		}
		if binary_installed {
			GatewayInstanceStatus::Stopped
		} else {
			GatewayInstanceStatus::NotProvisioned
		}
	}
}

/// Platform-specific diagnosis appended to spawn failures. aghub's own
/// downloads never carry the quarantine xattr (it is set by browsers, not
/// by direct HTTP writes), but a user-supplied `AGHUB_CLIPROXY_BIN`
/// downloaded via a browser will — and Gatekeeper then blocks the exec
/// with an opaque error.
fn spawn_hint(bin: &std::path::Path) -> String {
	#[cfg(target_os = "macos")]
	{
		let quarantined = std::process::Command::new("xattr")
			.arg("-p")
			.arg("com.apple.quarantine")
			.arg(bin)
			.output()
			.map(|output| output.status.success())
			.unwrap_or(false);
		if quarantined {
			return format!(
				"; the binary carries the com.apple.quarantine attribute \
				 (Gatekeeper). Clear it with: xattr -d \
				 com.apple.quarantine {}",
				bin.display()
			);
		}
	}
	let _ = bin;
	String::new()
}

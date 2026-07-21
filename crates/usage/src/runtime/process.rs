use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) struct CapturedStream {
	pub(crate) bytes: Vec<u8>,
	pub(crate) truncated: bool,
}

pub(crate) struct BoundedOutput {
	pub(crate) status: ExitStatus,
	pub(crate) stdout: CapturedStream,
	pub(crate) stderr: CapturedStream,
}

pub(crate) enum BoundedProcessError {
	Spawn(std::io::Error),
	Read(std::io::Error),
	TimedOut,
}

pub(crate) async fn run_bounded(
	command: &mut Command,
	timeout: Duration,
	stdout_limit: usize,
	stderr_limit: usize,
) -> Result<BoundedOutput, BoundedProcessError> {
	command
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.kill_on_drop(true);
	#[cfg(target_os = "windows")]
	command.creation_flags(CREATE_NO_WINDOW);
	prepare_command(command);
	let mut child = command.spawn().map_err(BoundedProcessError::Spawn)?;
	let child_tree = ChildTree::attach(&child);
	let stdout = child.stdout.take().expect("child stdout is piped");
	let stderr = child.stderr.take().expect("child stderr is piped");
	let execution = async {
		let (stdout, stderr, status) = tokio::join!(
			drain_output(stdout, stdout_limit),
			drain_output(stderr, stderr_limit),
			child.wait(),
		);
		Ok::<_, std::io::Error>(BoundedOutput {
			status: status?,
			stdout: stdout?,
			stderr: stderr?,
		})
	};
	match tokio::time::timeout(timeout, execution).await {
		Ok(Ok(output)) => {
			child_tree.disarm();
			Ok(output)
		}
		Ok(Err(error)) => {
			child_tree.terminate(&mut child).await;
			Err(BoundedProcessError::Read(error))
		}
		Err(_) => {
			child_tree.terminate(&mut child).await;
			Err(BoundedProcessError::TimedOut)
		}
	}
}

async fn drain_output(
	mut reader: impl AsyncRead + Unpin,
	limit: usize,
) -> std::io::Result<CapturedStream> {
	let mut bytes = Vec::new();
	let mut truncated = false;
	let mut buffer = vec![0_u8; 8192];
	loop {
		let read = reader.read(&mut buffer).await?;
		if read == 0 {
			break;
		}
		let remaining = limit.saturating_sub(bytes.len());
		let retained = remaining.min(read);
		bytes.extend_from_slice(&buffer[..retained]);
		truncated |= retained < read;
	}
	Ok(CapturedStream { bytes, truncated })
}

fn prepare_command(command: &mut Command) {
	#[cfg(unix)]
	command.process_group(0);
	#[cfg(not(unix))]
	let _ = command;
}

struct ChildTree {
	#[cfg(unix)]
	process_id: Option<u32>,
	armed: bool,
	#[cfg(target_os = "windows")]
	job: Option<ProcessJob>,
}

impl ChildTree {
	fn attach(child: &Child) -> Self {
		#[cfg(not(any(unix, target_os = "windows")))]
		let _ = child;
		Self {
			#[cfg(unix)]
			process_id: child.id(),
			armed: true,
			#[cfg(target_os = "windows")]
			job: ProcessJob::assign(child)
				.inspect_err(|error| {
					log::warn!(
						"failed to contain ccusage child process: {error}"
					);
				})
				.ok(),
		}
	}

	fn disarm(mut self) {
		self.armed = false;
	}

	async fn terminate(mut self, child: &mut Child) {
		self.stop_tree();
		self.armed = false;
		let _ = child.kill().await;
		let _ = child.wait().await;
	}

	fn stop_tree(&mut self) {
		#[cfg(unix)]
		if let Some(process_id) =
			self.process_id.and_then(|value| i32::try_from(value).ok())
		{
			// Each child starts in its own process group, so a negative PID
			// reaches the command and every process it started.
			let result = unsafe { libc::kill(-process_id, libc::SIGKILL) };
			if result == -1 {
				let error = std::io::Error::last_os_error();
				if error.raw_os_error() != Some(libc::ESRCH) {
					log::warn!(
						"failed to stop ccusage child process group: {error}"
					);
				}
			}
		}
		#[cfg(target_os = "windows")]
		drop(self.job.take());
	}
}

impl Drop for ChildTree {
	fn drop(&mut self) {
		if self.armed {
			self.stop_tree();
		}
	}
}

#[cfg(target_os = "windows")]
struct ProcessJob(isize);

#[cfg(target_os = "windows")]
impl ProcessJob {
	fn assign(child: &Child) -> std::io::Result<Self> {
		use std::ffi::c_void;
		use windows_sys::Win32::System::JobObjects::{
			AssignProcessToJobObject, CreateJobObjectW,
			JobObjectExtendedLimitInformation, SetInformationJobObject,
			JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
			JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		};

		// The unnamed job belongs only to this child invocation.
		let handle =
			unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
		if handle.is_null() {
			return Err(std::io::Error::last_os_error());
		}
		let job = Self(handle as isize);
		let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
		limits.BasicLimitInformation.LimitFlags =
			JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
		let configured = unsafe {
			SetInformationJobObject(
				job.handle(),
				JobObjectExtendedLimitInformation,
				&limits as *const _ as *const c_void,
				std::mem::size_of_val(&limits) as u32,
			)
		};
		if configured == 0 {
			return Err(std::io::Error::last_os_error());
		}
		let process = child.raw_handle().ok_or_else(|| {
			std::io::Error::other("ccusage child has no process handle")
		})?;
		let assigned =
			unsafe { AssignProcessToJobObject(job.handle(), process) };
		if assigned == 0 {
			return Err(std::io::Error::last_os_error());
		}
		Ok(job)
	}

	fn handle(&self) -> *mut std::ffi::c_void {
		self.0 as *mut std::ffi::c_void
	}
}

#[cfg(target_os = "windows")]
impl Drop for ProcessJob {
	fn drop(&mut self) {
		use windows_sys::Win32::Foundation::CloseHandle;

		// KILL_ON_JOB_CLOSE stops descendants that still belong to the job.
		unsafe {
			CloseHandle(self.handle());
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use tokio::io::AsyncWriteExt;

	#[tokio::test]
	async fn drains_process_output_with_a_bounded_prefix() {
		let (mut writer, reader) = tokio::io::duplex(512);
		let write = tokio::spawn(async move {
			writer.write_all(&vec![b'x'; 8192]).await.unwrap();
		});
		let captured = drain_output(reader, 128).await.unwrap();
		write.await.unwrap();
		assert_eq!(captured.bytes.len(), 128);
		assert!(captured.truncated);
	}
}

use tokio::process::{Child, Command};

pub(crate) fn prepare_command(command: &mut Command) {
	#[cfg(unix)]
	command.process_group(0);
	#[cfg(not(unix))]
	let _ = command;
}

pub(crate) struct ChildTree {
	#[cfg(unix)]
	process_id: Option<u32>,
	armed: bool,
	#[cfg(target_os = "windows")]
	job: Option<ProcessJob>,
}

impl ChildTree {
	pub(crate) fn attach(child: &Child) -> Self {
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

	pub(crate) fn disarm(mut self) {
		self.armed = false;
	}

	pub(crate) async fn terminate(mut self, child: &mut Child) {
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
		let assigned = unsafe {
			AssignProcessToJobObject(job.handle(), process as *mut c_void)
		};
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

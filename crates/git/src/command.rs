//! Controlled Git child-process lifecycle and environment isolation.

use std::{
	ffi::OsStr,
	io,
	process::{Child, ChildStdout, Command, ExitStatus},
	sync::atomic::{AtomicBool, Ordering},
	thread,
	time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::{credentials::Credentials, error::GitError, Result};

const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(25);
const UNSAFE_GIT_ENVIRONMENT: &[&str] = &[
	"GIT_CURL_VERBOSE",
	"GIT_SSL_NO_VERIFY",
	"GIT_TRACE",
	"GIT_TRACE_CURL",
	"GIT_TRACE_CURL_NO_DATA",
	"GIT_TRACE_PACKET",
	"GIT_TRACE_PACK_ACCESS",
	"GIT_TRACE_PERFORMANCE",
	"GIT_TRACE_REDACT",
	"GIT_TRACE_SETUP",
	"GIT_TRACE_SHALLOW",
	"GIT_TRACE2",
	"GIT_TRACE2_BRIEF",
	"GIT_TRACE2_CONFIG_PARAMS",
	"GIT_TRACE2_DST_DEBUG",
	"GIT_TRACE2_ENV_VARS",
	"GIT_TRACE2_EVENT",
	"GIT_TRACE2_PERF",
];

pub(crate) struct GitChild {
	process: Child,
	#[cfg(windows)]
	job: std::os::windows::io::OwnedHandle,
}

impl GitChild {
	pub(crate) fn take_stdout(&mut self) -> Option<ChildStdout> {
		self.process.stdout.take()
	}
}

impl Drop for GitChild {
	fn drop(&mut self) {
		if !matches!(self.process.try_wait(), Ok(Some(_))) {
			let _ = terminate_and_wait(self);
		}
	}
}

pub(crate) fn git_command(
	program: &OsStr,
	remote_url: &str,
	credentials: Option<&Credentials>,
) -> Command {
	let mut command = Command::new(program);
	command
		.env("GIT_CONFIG_NOSYSTEM", "1")
		.env("GIT_CONFIG_GLOBAL", null_git_config())
		.env("GIT_TERMINAL_PROMPT", "0")
		.env("GCM_INTERACTIVE", "never")
		.env_remove("GIT_CONFIG_PARAMETERS")
		.env_remove("GIT_USERNAME")
		.env_remove("GIT_PASSWORD")
		.env_remove("GIT_ASKPASS")
		.env_remove("SSH_ASKPASS")
		.env_remove("SSH_ASKPASS_REQUIRE")
		.env_remove("GIT_EXEC_PATH")
		.env_remove("GIT_DIR")
		.env_remove("GIT_WORK_TREE")
		.env_remove("GIT_INDEX_FILE")
		.env_remove("GIT_OBJECT_DIRECTORY")
		.env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES");
	for name in UNSAFE_GIT_ENVIRONMENT {
		command.env_remove(name);
	}

	let mut config = vec![
		("credential.helper".to_string(), String::new()),
		("credential.interactive".to_string(), "never".to_string()),
		("core.askPass".to_string(), String::new()),
		("http.extraHeader".to_string(), String::new()),
		("http.sslVerify".to_string(), "true".to_string()),
	];
	if let Some(credentials) = credentials {
		let value =
			format!("{}:{}", credentials.username, credentials.password);
		config.push((
			format!("http.{remote_url}.extraHeader"),
			format!("Authorization: Basic {}", STANDARD.encode(value)),
		));
	}
	command.env("GIT_CONFIG_COUNT", config.len().to_string());
	for (index, (key, value)) in config.into_iter().enumerate() {
		command
			.env(format!("GIT_CONFIG_KEY_{index}"), key)
			.env(format!("GIT_CONFIG_VALUE_{index}"), value);
	}

	#[cfg(unix)]
	{
		use std::os::unix::process::CommandExt;
		command.process_group(0);
	}

	command
}

pub(crate) fn spawn_git(command: &mut Command) -> io::Result<GitChild> {
	#[cfg(not(windows))]
	let process = command.spawn()?;
	#[cfg(windows)]
	let (process, job) = {
		use std::os::windows::process::CommandExt;
		use windows_sys::Win32::System::Threading::CREATE_SUSPENDED;

		command.creation_flags(CREATE_SUSPENDED);
		let mut process = command.spawn()?;
		let job = match assign_kill_job(&process) {
			Ok(job) => job,
			Err(error) => {
				let _ = process.kill();
				let _ = process.wait();
				return Err(error);
			}
		};
		if let Err(error) = resume_suspended_process(&process) {
			let _ = terminate_job(&job);
			let _ = process.kill();
			let _ = process.wait();
			return Err(error);
		}
		(process, job)
	};
	Ok(GitChild {
		process,
		#[cfg(windows)]
		job,
	})
}

pub(crate) fn wait_for_git<F>(
	child: &mut GitChild,
	timeout: Duration,
	cancelled: &AtomicBool,
	mut inspect: F,
) -> Result<ExitStatus>
where
	F: FnMut() -> Result<bool>,
{
	let started = Instant::now();
	let mut status = None;
	loop {
		if cancelled.load(Ordering::Acquire) {
			terminate_and_wait(child)?;
			return Err(GitError::Cancelled);
		}
		if started.elapsed() >= timeout {
			terminate_and_wait(child)?;
			return Err(GitError::TimedOut);
		}
		let inspection_complete = match inspect() {
			Ok(complete) => complete,
			Err(error) => {
				terminate_and_wait(child)?;
				return Err(error);
			}
		};
		if status.is_none() {
			status = child.process.try_wait()?;
		}
		if inspection_complete {
			if let Some(status) = status {
				return Ok(status);
			}
		}
		thread::sleep(PROCESS_POLL_INTERVAL);
	}
}

pub(crate) fn terminate_and_wait(
	child: &mut GitChild,
) -> io::Result<ExitStatus> {
	#[cfg(unix)]
	unsafe {
		let process_group = -(child.process.id() as i32);
		let _ = libc::kill(process_group, libc::SIGKILL);
	}
	#[cfg(windows)]
	let job_result = terminate_job(&child.job);
	let _ = child.process.kill();
	let status = child.process.wait();
	#[cfg(windows)]
	job_result?;
	status
}

#[cfg(windows)]
fn terminate_job(job: &std::os::windows::io::OwnedHandle) -> io::Result<()> {
	use std::os::windows::io::AsRawHandle;
	use windows_sys::Win32::System::JobObjects::TerminateJobObject;

	// The handle is owned for this call and points to a Job Object created by
	// `assign_kill_job`.
	let terminated = unsafe { TerminateJobObject(job.as_raw_handle() as _, 1) };
	if terminated == 0 {
		return Err(io::Error::last_os_error());
	}
	Ok(())
}

#[cfg(windows)]
fn resume_suspended_process(process: &Child) -> io::Result<()> {
	use std::{
		mem::size_of,
		os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
	};
	use windows_sys::Win32::{
		Foundation::{ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
		System::{
			Diagnostics::ToolHelp::{
				CreateToolhelp32Snapshot, Thread32First, Thread32Next,
				TH32CS_SNAPTHREAD, THREADENTRY32,
			},
			Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME},
		},
	};

	// CREATE_SUSPENDED prevents the new process from starting helpers before
	// its primary thread is found and the process has joined the Job Object.
	let raw_snapshot =
		unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
	if raw_snapshot == INVALID_HANDLE_VALUE {
		return Err(io::Error::last_os_error());
	}
	let snapshot = unsafe { OwnedHandle::from_raw_handle(raw_snapshot as _) };
	let mut entry = THREADENTRY32 {
		dwSize: size_of::<THREADENTRY32>() as u32,
		..THREADENTRY32::default()
	};
	let found =
		unsafe { Thread32First(snapshot.as_raw_handle() as _, &mut entry) };
	if found == 0 {
		return Err(io::Error::last_os_error());
	}
	loop {
		if entry.th32OwnerProcessID == process.id() {
			let raw_thread = unsafe {
				OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID)
			};
			if raw_thread.is_null() {
				return Err(io::Error::last_os_error());
			}
			let thread =
				unsafe { OwnedHandle::from_raw_handle(raw_thread as _) };
			let previous_count =
				unsafe { ResumeThread(thread.as_raw_handle() as _) };
			if previous_count == u32::MAX {
				return Err(io::Error::last_os_error());
			}
			return Ok(());
		}
		let found =
			unsafe { Thread32Next(snapshot.as_raw_handle() as _, &mut entry) };
		if found == 0 {
			let error = io::Error::last_os_error();
			if error.raw_os_error() == Some(ERROR_NO_MORE_FILES as i32) {
				break;
			}
			return Err(error);
		}
	}

	Err(io::Error::new(
		io::ErrorKind::NotFound,
		"suspended Git process thread was not found",
	))
}

#[cfg(windows)]
fn assign_kill_job(
	process: &Child,
) -> io::Result<std::os::windows::io::OwnedHandle> {
	use std::{
		ffi::c_void,
		mem::size_of,
		os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
		ptr,
	};
	use windows_sys::Win32::System::JobObjects::{
		AssignProcessToJobObject, CreateJobObjectW,
		JobObjectExtendedLimitInformation, SetInformationJobObject,
		JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
		JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
	};

	let raw_job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
	if raw_job.is_null() {
		return Err(io::Error::last_os_error());
	}
	let job = unsafe { OwnedHandle::from_raw_handle(raw_job as _) };
	let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
	limits.BasicLimitInformation.LimitFlags =
		JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
	let configured = unsafe {
		SetInformationJobObject(
			job.as_raw_handle() as _,
			JobObjectExtendedLimitInformation,
			&limits as *const _ as *const c_void,
			size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
		)
	};
	if configured == 0 {
		return Err(io::Error::last_os_error());
	}
	let assigned = unsafe {
		AssignProcessToJobObject(
			job.as_raw_handle() as _,
			process.as_raw_handle() as _,
		)
	};
	if assigned == 0 {
		return Err(io::Error::last_os_error());
	}
	Ok(job)
}

pub(crate) fn command_failed(
	operation: &'static str,
	status: ExitStatus,
) -> GitError {
	GitError::CommandFailed {
		operation,
		status: status.to_string(),
	}
}

#[cfg(windows)]
fn null_git_config() -> &'static str {
	"NUL"
}

#[cfg(not(windows))]
fn null_git_config() -> &'static str {
	"/dev/null"
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn command_removes_ambient_username_and_password() {
		let command = git_command(
			OsStr::new("git"),
			"https://github.com/owner/repo.git",
			None,
		);
		let environment = command.get_envs().collect::<Vec<_>>();

		for name in ["GIT_USERNAME", "GIT_PASSWORD"] {
			assert!(environment.iter().any(|(key, value)| {
				*key == OsStr::new(name) && value.is_none()
			}));
		}
	}

	#[test]
	fn command_removes_trace_and_tls_override_environment() {
		let command = git_command(
			OsStr::new("git"),
			"https://github.com/owner/repo.git",
			None,
		);
		let environment = command.get_envs().collect::<Vec<_>>();

		for name in UNSAFE_GIT_ENVIRONMENT {
			assert!(environment.iter().any(|(key, value)| {
				*key == OsStr::new(name) && value.is_none()
			}));
		}
		assert!(environment.iter().any(|(key, value)| {
			*key == OsStr::new("GIT_CONFIG_KEY_4")
				&& *value == Some(OsStr::new("http.sslVerify"))
		}));
		assert!(environment.iter().any(|(key, value)| {
			*key == OsStr::new("GIT_CONFIG_VALUE_4")
				&& *value == Some(OsStr::new("true"))
		}));
	}

	#[test]
	fn explicit_credentials_are_not_command_arguments() {
		let credentials = Credentials::new("git-user", "secret-token");
		let command = git_command(
			OsStr::new("git"),
			"https://github.com/owner/repo.git",
			Some(&credentials),
		);

		assert!(command.get_args().next().is_none());
		assert!(command.get_envs().any(|(key, value)| {
			key == OsStr::new("GIT_CONFIG_KEY_5")
				&& value
					== Some(OsStr::new(
						"http.https://github.com/owner/repo.git.extraHeader",
					))
		}));
		assert!(command.get_envs().any(|(key, value)| {
			key == OsStr::new("GIT_CONFIG_VALUE_5")
				&& value
					== Some(OsStr::new(
						"Authorization: Basic \
					Z2l0LXVzZXI6c2VjcmV0LXRva2Vu",
					))
		}));
	}

	#[cfg(windows)]
	#[test]
	fn spawned_git_resumes_after_job_assignment() {
		let mut command = Command::new("cmd.exe");
		command.args(["/C", "exit", "0"]);
		let mut child = spawn_git(&mut command).unwrap();
		let cancelled = AtomicBool::new(false);
		let status = wait_for_git(
			&mut child,
			Duration::from_secs(5),
			&cancelled,
			|| Ok(true),
		)
		.unwrap();

		assert!(status.success());
	}
}

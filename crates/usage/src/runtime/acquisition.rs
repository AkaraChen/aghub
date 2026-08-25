use super::discovery::PackageRunner;
use super::process;
use super::registry::{platform_package, CcusageRegistry};
use super::storage::{executable_file_name, prepare_staged_binary};
use super::{CcusageRuntimeError, CcusageRuntimeSource};
use semver::Version;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const INSTALL_TIMEOUT: Duration = Duration::from_secs(180);
const RUNNER_PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ERROR_BYTES: usize = 4096;
const MINIMUM_BUN_VERSION: Version = Version::new(1, 3, 0);

pub(super) async fn acquire_with_package_runner(
	source: CcusageRuntimeSource,
	runner: &PackageRunner,
	version: &Version,
	stage: &Path,
) -> Result<PathBuf, CcusageRuntimeError> {
	validate_package_runner(source, runner).await?;
	let platform = platform_package()?;
	fs::write(stage.join("package.json"), b"{\"private\":true}\n")?;
	let package_spec = format!("{}@{version}", platform.package_name);
	let args = package_command_args(source, stage, &package_spec)?;
	let mut command = runner.command();
	command.current_dir(stage).args(args);
	let output = run_command(&mut command, INSTALL_TIMEOUT, source).await?;
	if !output.status.success() {
		let captured = if output.stderr.bytes.is_empty() {
			&output.stdout
		} else {
			&output.stderr
		};
		let mut message = String::from_utf8_lossy(&captured.bytes).to_string();
		if captured.truncated {
			message.push_str("\noutput truncated");
		}
		return Err(CcusageRuntimeError::PackageInstallFailed {
			provider: source,
			message: message.trim().to_string(),
		});
	}

	let installed = stage
		.join("node_modules")
		.join("@ccusage")
		.join(
			platform
				.package_name
				.strip_prefix("@ccusage/")
				.expect("platform package is scoped"),
		)
		.join("bin")
		.join(executable_file_name());
	validate_staged_path(stage, &installed)?;
	let native_dir = stage.join("native");
	fs::create_dir_all(&native_dir)?;
	let destination = native_dir.join(executable_file_name());
	fs::copy(installed, &destination)?;
	prepare_staged_binary(&destination)?;
	Ok(destination)
}

pub(super) async fn validate_package_runner(
	source: CcusageRuntimeSource,
	runner: &PackageRunner,
) -> Result<(), CcusageRuntimeError> {
	let mut command = runner.command();
	command.arg("--version");
	let output =
		run_command(&mut command, RUNNER_PROBE_TIMEOUT, source).await?;
	if output.stdout.truncated || output.stderr.truncated {
		return Err(CcusageRuntimeError::InvalidBinary(format!(
			"{} --version produced too much output",
			runner.program().display()
		)));
	}
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr.bytes);
		return Err(CcusageRuntimeError::PackageInstallFailed {
			provider: source,
			message: stderr.trim().to_string(),
		});
	}
	let version =
		parse_runner_version(&output.stdout.bytes).map_err(|error| {
			CcusageRuntimeError::InvalidBinary(format!(
				"{} returned an invalid version: {error}",
				runner.program().display()
			))
		})?;
	if source == CcusageRuntimeSource::Bun && version < MINIMUM_BUN_VERSION {
		return Err(CcusageRuntimeError::InvalidBinary(format!(
			"bun {version} cannot install ccusage; version {MINIMUM_BUN_VERSION} or newer is required"
		)));
	}
	Ok(())
}

pub(super) async fn runner_owns_global_install(
	source: CcusageRuntimeSource,
	runner: &PackageRunner,
	executable: &Path,
) -> Result<bool, CcusageRuntimeError> {
	let args = match source {
		CcusageRuntimeSource::Bun => &["pm", "bin", "-g"][..],
		CcusageRuntimeSource::Npm => &["prefix", "--global"][..],
		_ => return Ok(false),
	};
	let mut command = runner.command();
	command.args(args);
	let output =
		run_command(&mut command, RUNNER_PROBE_TIMEOUT, source).await?;
	if output.stdout.truncated || output.stderr.truncated {
		return Err(CcusageRuntimeError::InvalidBinary(format!(
			"{} global path query produced too much output",
			runner.program().display()
		)));
	}
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr.bytes);
		return Err(CcusageRuntimeError::PackageInstallFailed {
			provider: source,
			message: stderr.trim().to_string(),
		});
	}
	let location = String::from_utf8_lossy(&output.stdout.bytes)
		.lines()
		.map(str::trim)
		.rfind(|line| !line.is_empty())
		.map(PathBuf::from)
		.ok_or_else(|| {
			CcusageRuntimeError::InvalidBinary(format!(
				"{} returned an empty global package path",
				runner.program().display()
			))
		})?;

	let command_directory = match source {
		CcusageRuntimeSource::Bun => location,
		CcusageRuntimeSource::Npm if cfg!(target_os = "windows") => location,
		CcusageRuntimeSource::Npm => location.join("bin"),
		_ => return Ok(false),
	};
	Ok(["ccusage", "ccusage.exe", "ccusage.cmd", "ccusage.bat"]
		.into_iter()
		.map(|name| command_directory.join(name))
		.any(|candidate| paths_refer_to_same_file(executable, &candidate)))
}

pub(super) async fn update_global_package(
	source: CcusageRuntimeSource,
	runner: &PackageRunner,
	version: &Version,
) -> Result<(), CcusageRuntimeError> {
	validate_package_runner(source, runner).await?;
	let args = global_package_update_args(source, version)?;
	let mut command = runner.command();
	command.args(args);
	let output = run_command(&mut command, INSTALL_TIMEOUT, source).await?;
	if !output.status.success() {
		let captured = if output.stderr.bytes.is_empty() {
			&output.stdout
		} else {
			&output.stderr
		};
		let mut message = String::from_utf8_lossy(&captured.bytes).to_string();
		if captured.truncated {
			message.push_str("\noutput truncated");
		}
		return Err(CcusageRuntimeError::PackageInstallFailed {
			provider: source,
			message: message.trim().to_string(),
		});
	}
	Ok(())
}

async fn run_command(
	command: &mut tokio::process::Command,
	timeout: Duration,
	source: CcusageRuntimeSource,
) -> Result<process::BoundedOutput, CcusageRuntimeError> {
	match process::run_bounded(
		command,
		timeout,
		MAX_ERROR_BYTES,
		MAX_ERROR_BYTES,
	)
	.await
	{
		Ok(output) => Ok(output),
		Err(error) => Err(package_process_error(source, error)),
	}
}

fn package_process_error(
	source: CcusageRuntimeSource,
	error: process::BoundedProcessError,
) -> CcusageRuntimeError {
	match error {
		process::BoundedProcessError::Spawn(error)
		| process::BoundedProcessError::Read(error) => {
			CcusageRuntimeError::PackageInstallFailed {
				provider: source,
				message: error.to_string(),
			}
		}
		process::BoundedProcessError::TimedOut => {
			CcusageRuntimeError::InstallTimedOut(source)
		}
	}
}

fn parse_runner_version(output: &[u8]) -> Result<Version, semver::Error> {
	String::from_utf8_lossy(output)
		.split_whitespace()
		.last()
		.unwrap_or_default()
		.trim_start_matches('v')
		.parse()
}

pub(super) async fn acquire_with_download(
	registry: &CcusageRegistry,
	version: &Version,
	stage: &Path,
) -> Result<PathBuf, CcusageRuntimeError> {
	let destination = stage.join("native").join(executable_file_name());
	registry
		.download_platform_binary(version, &destination)
		.await?;
	Ok(destination)
}

fn package_command_args(
	source: CcusageRuntimeSource,
	stage: &Path,
	package_spec: &str,
) -> Result<Vec<String>, CcusageRuntimeError> {
	let prefix = stage.to_string_lossy().into_owned();
	match source {
		CcusageRuntimeSource::Bun => Ok(vec![
			"add".to_string(),
			"--no-save".to_string(),
			"--ignore-scripts".to_string(),
			"--exact".to_string(),
			package_spec.to_string(),
		]),
		CcusageRuntimeSource::Npm => Ok(vec![
			"install".to_string(),
			"--prefix".to_string(),
			prefix,
			"--no-save".to_string(),
			"--ignore-scripts".to_string(),
			"--package-lock=false".to_string(),
			"--fund=false".to_string(),
			"--audit=false".to_string(),
			package_spec.to_string(),
		]),
		_ => Err(CcusageRuntimeError::SourceCannotInstall(source)),
	}
}

fn global_package_update_args(
	source: CcusageRuntimeSource,
	version: &Version,
) -> Result<Vec<String>, CcusageRuntimeError> {
	let package_spec = format!("ccusage@{version}");
	match source {
		CcusageRuntimeSource::Bun => Ok(vec![
			"add".to_string(),
			"--global".to_string(),
			"--ignore-scripts".to_string(),
			"--exact".to_string(),
			package_spec,
		]),
		CcusageRuntimeSource::Npm => Ok(vec![
			"install".to_string(),
			"--global".to_string(),
			"--ignore-scripts".to_string(),
			"--save-exact".to_string(),
			"--fund=false".to_string(),
			"--audit=false".to_string(),
			package_spec,
		]),
		_ => Err(CcusageRuntimeError::SourceCannotUpdate(source)),
	}
}

fn paths_refer_to_same_file(left: &Path, right: &Path) -> bool {
	if left == right {
		return true;
	}
	left.canonicalize()
		.ok()
		.zip(right.canonicalize().ok())
		.is_some_and(|(left, right)| left == right)
}

fn validate_staged_path(
	stage: &Path,
	candidate: &Path,
) -> Result<(), CcusageRuntimeError> {
	let metadata = fs::symlink_metadata(candidate).map_err(|error| {
		CcusageRuntimeError::InvalidBinary(format!(
			"installed package has no native ccusage binary at {}: {error}",
			candidate.display()
		))
	})?;
	if !metadata.file_type().is_file() {
		return Err(CcusageRuntimeError::InvalidBinary(format!(
			"installed ccusage path is not a regular file: {}",
			candidate.display()
		)));
	}
	let stage = stage.canonicalize()?;
	let candidate = candidate.canonicalize()?;
	if !candidate.starts_with(&stage) {
		return Err(CcusageRuntimeError::InvalidBinary(
			"installed ccusage binary escaped its staging directory"
				.to_string(),
		));
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Stdio;

	#[cfg(unix)]
	fn shell_runner(script: PathBuf) -> PackageRunner {
		PackageRunner::with_prefix(
			PathBuf::from("/bin/sh"),
			vec![script.into_os_string()],
		)
	}

	#[test]
	fn package_installs_are_local_and_disable_scripts() {
		let stage = Path::new("/app data/ccusage/staging/one");
		for source in [CcusageRuntimeSource::Bun, CcusageRuntimeSource::Npm] {
			let args =
				package_command_args(source, stage, "@ccusage/pkg@20.0.1")
					.unwrap();
			assert!(args.iter().any(|arg| arg == "--ignore-scripts"));
			assert!(!args.iter().any(|arg| arg == "--global" || arg == "-g"));
		}
		let npm = package_command_args(
			CcusageRuntimeSource::Npm,
			stage,
			"@ccusage/pkg@20.0.1",
		)
		.unwrap();
		assert!(npm.windows(2).any(|pair| {
			pair == ["--prefix", "/app data/ccusage/staging/one"]
		}));
	}

	#[test]
	fn parses_package_runner_versions() {
		assert_eq!(
			parse_runner_version(b"1.3.2\n").unwrap(),
			Version::new(1, 3, 2)
		);
		assert_eq!(
			parse_runner_version(b"npm v11.4.0\n").unwrap(),
			Version::new(11, 4, 0)
		);
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn recognizes_bun_global_installation() {
		use std::os::unix::fs::symlink;

		let root = tempfile::tempdir().unwrap();
		let bin = root.path().join("bun-bin");
		let package = root.path().join("node_modules/ccusage/src/cli.js");
		let runner = root.path().join("bun");
		fs::create_dir_all(&bin).unwrap();
		fs::create_dir_all(package.parent().unwrap()).unwrap();
		fs::write(&package, b"fixture").unwrap();
		symlink(&package, bin.join("ccusage")).unwrap();
		fs::write(
			&runner,
			format!("#!/bin/sh\nprintf '%s\\n' '{}'\n", bin.display()),
		)
		.unwrap();

		assert!(runner_owns_global_install(
			CcusageRuntimeSource::Bun,
			&shell_runner(runner),
			&bin.join("ccusage"),
		)
		.await
		.unwrap());
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn recognizes_bun_global_command_wrapper() {
		let root = tempfile::tempdir().unwrap();
		let bin = root.path().join("bun-bin");
		let command = bin.join("ccusage.cmd");
		let runner = root.path().join("bun");
		fs::create_dir_all(&bin).unwrap();
		fs::write(&command, b"fixture").unwrap();
		fs::write(
			&runner,
			format!("#!/bin/sh\nprintf '%s\\n' '{}'\n", bin.display()),
		)
		.unwrap();

		assert!(runner_owns_global_install(
			CcusageRuntimeSource::Bun,
			&shell_runner(runner),
			&command,
		)
		.await
		.unwrap());
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn recognizes_npm_global_installation() {
		use std::os::unix::fs::symlink;

		let root = tempfile::tempdir().unwrap();
		let prefix = root.path().join("npm-prefix");
		let package_root = prefix.join("lib/node_modules");
		let executable = package_root.join("ccusage/src/cli.js");
		let command = prefix.join("bin/ccusage");
		let runner = root.path().join("npm");
		fs::create_dir_all(executable.parent().unwrap()).unwrap();
		fs::create_dir_all(command.parent().unwrap()).unwrap();
		fs::write(&executable, b"fixture").unwrap();
		symlink(&executable, &command).unwrap();
		fs::write(
			&runner,
			format!("#!/bin/sh\nprintf '%s\\n' '{}'\n", prefix.display()),
		)
		.unwrap();

		assert!(runner_owns_global_install(
			CcusageRuntimeSource::Npm,
			&shell_runner(runner),
			&executable,
		)
		.await
		.unwrap());
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn recognizes_npm_global_command_wrapper() {
		let root = tempfile::tempdir().unwrap();
		let prefix = root.path().join("npm-prefix");
		let command = prefix.join("bin/ccusage");
		let runner = root.path().join("npm");
		fs::create_dir_all(command.parent().unwrap()).unwrap();
		fs::write(&command, b"fixture").unwrap();
		fs::write(
			&runner,
			format!("#!/bin/sh\nprintf '%s\\n' '{}'\n", prefix.display()),
		)
		.unwrap();

		assert!(runner_owns_global_install(
			CcusageRuntimeSource::Npm,
			&shell_runner(runner),
			&command,
		)
		.await
		.unwrap());
	}

	#[test]
	fn global_updates_use_the_selected_package_runner() {
		let version = Version::new(20, 0, 19);
		let bun =
			global_package_update_args(CcusageRuntimeSource::Bun, &version)
				.unwrap();
		let npm =
			global_package_update_args(CcusageRuntimeSource::Npm, &version)
				.unwrap();

		assert_eq!(bun[0], "add");
		assert!(bun.iter().any(|arg| arg == "--global"));
		assert!(bun.iter().any(|arg| arg == "ccusage@20.0.19"));
		assert_eq!(npm[0], "install");
		assert!(npm.iter().any(|arg| arg == "--global"));
		assert!(npm.iter().any(|arg| arg == "ccusage@20.0.19"));
	}

	#[test]
	fn package_process_io_is_reported_as_provider_failure() {
		for error in [
			process::BoundedProcessError::Spawn(std::io::Error::new(
				std::io::ErrorKind::NotFound,
				"missing runner",
			)),
			process::BoundedProcessError::Read(std::io::Error::new(
				std::io::ErrorKind::BrokenPipe,
				"broken output",
			)),
		] {
			let error = package_process_error(CcusageRuntimeSource::Bun, error);
			assert!(matches!(
				error,
				CcusageRuntimeError::PackageInstallFailed {
					provider: CcusageRuntimeSource::Bun,
					..
				}
			));
		}
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn timeout_stops_package_runner_descendants() {
		let root = tempfile::tempdir().unwrap();
		let marker = root.path().join("descendant-finished");
		let mut command = tokio::process::Command::new("/bin/sh");
		command
			.arg("-c")
			.arg("(sleep 0.5; printf leaked > \"$1\") & wait")
			.arg("fixture")
			.arg(&marker)
			.stdin(Stdio::null())
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			.kill_on_drop(true);

		let error = match run_command(
			&mut command,
			Duration::from_millis(50),
			CcusageRuntimeSource::Bun,
		)
		.await
		{
			Ok(_) => panic!("package runner should time out"),
			Err(error) => error,
		};
		assert!(matches!(
			error,
			CcusageRuntimeError::InstallTimedOut(CcusageRuntimeSource::Bun)
		));
		tokio::time::sleep(Duration::from_millis(600)).await;
		assert!(!marker.exists());
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn cancellation_stops_package_runner_descendants() {
		let root = tempfile::tempdir().unwrap();
		let marker = root.path().join("descendant-finished");
		let mut command = tokio::process::Command::new("/bin/sh");
		command
			.arg("-c")
			.arg("(sleep 0.5; printf leaked > \"$1\") & wait")
			.arg("fixture")
			.arg(&marker)
			.stdin(Stdio::null())
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			.kill_on_drop(true);

		let result = tokio::time::timeout(
			Duration::from_millis(50),
			run_command(
				&mut command,
				Duration::from_secs(5),
				CcusageRuntimeSource::Bun,
			),
		)
		.await;
		assert!(result.is_err());
		tokio::time::sleep(Duration::from_millis(600)).await;
		assert!(!marker.exists());
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn rejects_bun_older_than_the_supported_version() {
		use std::os::unix::fs::PermissionsExt;

		let root = tempfile::tempdir().unwrap();
		let runner = root.path().join("bun");
		fs::write(&runner, b"#!/bin/sh\necho 1.2.9\n").unwrap();
		fs::set_permissions(&runner, fs::Permissions::from_mode(0o755))
			.unwrap();
		let runner = PackageRunner::direct(runner);
		let error = validate_package_runner(CcusageRuntimeSource::Bun, &runner)
			.await
			.expect_err("old Bun rejected");
		assert!(matches!(error, CcusageRuntimeError::InvalidBinary(_)));
	}
}

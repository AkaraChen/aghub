use super::storage;
use super::{
	CcusageRuntimeError, CcusageRuntimePreference, CcusageRuntimeSource,
	RuntimeCandidate,
};
use semver::Version;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_VERSION_OUTPUT_BYTES: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct PackageRunner {
	program: PathBuf,
	prefix_args: Vec<OsString>,
}

impl PackageRunner {
	pub(super) fn direct(program: PathBuf) -> Self {
		Self {
			program,
			prefix_args: Vec::new(),
		}
	}

	fn with_prefix(program: PathBuf, prefix_args: Vec<OsString>) -> Self {
		Self {
			program,
			prefix_args,
		}
	}

	pub(super) fn command(&self) -> tokio::process::Command {
		let mut command = tokio::process::Command::new(&self.program);
		command.args(&self.prefix_args);
		command
	}

	pub(super) fn program(&self) -> &Path {
		&self.program
	}
}

pub(super) async fn resolve_preference(
	root: &Path,
	bundled: Option<&Path>,
	preference: &CcusageRuntimePreference,
) -> Result<RuntimeCandidate, CcusageRuntimeError> {
	if let Some(path) = std::env::var_os("AGHUB_CCUSAGE_BIN") {
		return resolve_environment_override(PathBuf::from(path)).await;
	}

	validate_preference(root, bundled, preference).await
}

pub(super) async fn validate_preference(
	root: &Path,
	bundled: Option<&Path>,
	preference: &CcusageRuntimePreference,
) -> Result<RuntimeCandidate, CcusageRuntimeError> {
	if matches!(preference, CcusageRuntimePreference::Auto) {
		return resolve_auto_candidate(root, bundled).await;
	}

	match preference {
		CcusageRuntimePreference::Manual(path) => {
			candidate_from_path(CcusageRuntimeSource::Manual, path.clone())
				.await
		}
		CcusageRuntimePreference::Path => {
			let path = which::which("ccusage").map_err(|_| {
				CcusageRuntimeError::SourceUnavailable(
					CcusageRuntimeSource::Path,
				)
			})?;
			candidate_from_path(CcusageRuntimeSource::Path, path).await
		}
		CcusageRuntimePreference::Bun => {
			installed_candidate(root, CcusageRuntimeSource::Bun).await
		}
		CcusageRuntimePreference::Npm => {
			installed_candidate(root, CcusageRuntimeSource::Npm).await
		}
		CcusageRuntimePreference::Download => {
			installed_candidate(root, CcusageRuntimeSource::Download).await
		}
		CcusageRuntimePreference::Bundled => {
			let path = bundled
				.filter(|path| path.is_file())
				.map(Path::to_path_buf)
				.ok_or(CcusageRuntimeError::SourceUnavailable(
					CcusageRuntimeSource::Bundled,
				))?;
			candidate_from_path(CcusageRuntimeSource::Bundled, path).await
		}
		CcusageRuntimePreference::Auto => unreachable!(),
	}
}

pub(super) async fn resolve_environment_override(
	path: PathBuf,
) -> Result<RuntimeCandidate, CcusageRuntimeError> {
	candidate_from_path(
		CcusageRuntimeSource::Environment,
		resolve_environment_path(path)?,
	)
	.await
}

async fn resolve_auto_candidate(
	root: &Path,
	bundled: Option<&Path>,
) -> Result<RuntimeCandidate, CcusageRuntimeError> {
	if let Ok(path) = which::which("ccusage") {
		match candidate_from_path(CcusageRuntimeSource::Path, path.clone())
			.await
		{
			Ok(candidate) => return Ok(candidate),
			Err(error) => log::warn!(
				"ignored unusable ccusage Path candidate at {}: {error}",
				path.display()
			),
		}
	}
	for source in [
		CcusageRuntimeSource::Bun,
		CcusageRuntimeSource::Npm,
		CcusageRuntimeSource::Download,
	] {
		match installed_candidate(root, source).await {
			Ok(candidate) => return Ok(candidate),
			Err(CcusageRuntimeError::SourceNotInstalled(_)) => {}
			Err(error) => log::warn!(
				"ignored unusable installed ccusage {source:?}: {error}"
			),
		}
	}
	if let Some(path) = bundled.filter(|path| path.is_file()) {
		match candidate_from_path(
			CcusageRuntimeSource::Bundled,
			path.to_path_buf(),
		)
		.await
		{
			Ok(candidate) => return Ok(candidate),
			Err(error) => log::warn!(
				"ignored unusable bundled ccusage candidate at {}: {error}",
				path.display()
			),
		}
	}
	Err(CcusageRuntimeError::NoRuntime)
}

pub(super) async fn installed_candidate(
	root: &Path,
	source: CcusageRuntimeSource,
) -> Result<RuntimeCandidate, CcusageRuntimeError> {
	let installations = storage::installations(root, source)?;
	if installations.is_empty() {
		return Err(CcusageRuntimeError::SourceNotInstalled(source));
	}
	let mut last_error = None;
	for (_, path) in installations {
		match candidate_from_path(source, path.clone()).await {
			Ok(candidate) => return Ok(candidate),
			Err(error) => {
				log::warn!(
					"ignored unusable ccusage {source:?} installation at {}: {error}",
					path.display()
				);
				last_error = Some(error);
			}
		}
	}
	Err(last_error.unwrap_or(CcusageRuntimeError::SourceNotInstalled(source)))
}

pub(super) async fn candidate_from_path(
	source: CcusageRuntimeSource,
	path: PathBuf,
) -> Result<RuntimeCandidate, CcusageRuntimeError> {
	#[cfg(target_os = "windows")]
	let path = if is_command_script(&path) {
		let package = super::registry::platform_package()?;
		resolve_ccusage_command_script(&path, &package.package_name)
			.ok_or_else(|| {
				CcusageRuntimeError::InvalidBinary(
					"the ccusage command script has no native binary"
						.to_string(),
				)
			})?
	} else {
		path
	};
	let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
		CcusageRuntimeError::InvalidBinary(format!(
			"cannot inspect {}: {error}",
			path.display()
		))
	})?;
	if !metadata.file_type().is_file() && !metadata.file_type().is_symlink() {
		return Err(CcusageRuntimeError::InvalidBinary(format!(
			"{} is not an executable file",
			path.display()
		)));
	}
	let version = probe_version(&path).await?;
	Ok(RuntimeCandidate {
		source,
		path,
		version: version.to_string(),
	})
}

pub(super) async fn probe_version(
	path: &Path,
) -> Result<Version, CcusageRuntimeError> {
	probe_version_with_timeout(path, VERSION_TIMEOUT).await
}

async fn probe_version_with_timeout(
	path: &Path,
	timeout: Duration,
) -> Result<Version, CcusageRuntimeError> {
	let mut command = tokio::process::Command::new(path);
	command.arg("--version");
	let output = match super::process::run_bounded(
		&mut command,
		timeout,
		MAX_VERSION_OUTPUT_BYTES,
		MAX_VERSION_OUTPUT_BYTES,
	)
	.await
	{
		Ok(output) => output,
		Err(
			super::process::BoundedProcessError::Spawn(error)
			| super::process::BoundedProcessError::Read(error),
		) => {
			return Err(CcusageRuntimeError::Spawn {
				path: path.to_path_buf(),
				error,
			});
		}
		Err(super::process::BoundedProcessError::TimedOut) => {
			return Err(CcusageRuntimeError::VersionProbeTimedOut(
				path.to_path_buf(),
			));
		}
	};
	if output.stdout.truncated || output.stderr.truncated {
		return Err(CcusageRuntimeError::InvalidBinary(format!(
			"{} --version produced too much output",
			path.display()
		)));
	}
	if !output.status.success() {
		return Err(CcusageRuntimeError::InvalidBinary(format!(
			"{} --version exited with {}: {}",
			path.display(),
			output.status,
			String::from_utf8_lossy(&output.stderr.bytes).trim()
		)));
	}
	let raw = String::from_utf8_lossy(&output.stdout.bytes);
	let version = raw
		.split_whitespace()
		.last()
		.unwrap_or_default()
		.trim_start_matches('v');
	version.parse().map_err(|error| {
		CcusageRuntimeError::InvalidBinary(format!(
			"{} returned an invalid version '{}': {error}",
			path.display(),
			raw.trim()
		))
	})
}

pub(super) fn find_runner(
	source: CcusageRuntimeSource,
) -> Option<PackageRunner> {
	let name = match source {
		CcusageRuntimeSource::Bun => "bun",
		CcusageRuntimeSource::Npm => "npm",
		_ => return None,
	};
	let home = dirs::home_dir();
	let mut candidates = Vec::new();
	if let Ok(path) = which::which(name) {
		push_unique(&mut candidates, path);
	}
	for path in known_runner_paths(source, home.as_deref()) {
		push_unique(&mut candidates, path);
	}
	let node_candidates = known_node_paths(home.as_deref());
	candidates
		.into_iter()
		.find_map(|path| runner_from_path(source, path, &node_candidates))
}

fn known_runner_paths(
	source: CcusageRuntimeSource,
	home: Option<&Path>,
) -> Vec<PathBuf> {
	let mut paths = Vec::new();
	let file_name = runner_file_name(source);
	let environment_root = match source {
		CcusageRuntimeSource::Bun => std::env::var_os("BUN_INSTALL"),
		CcusageRuntimeSource::Npm => std::env::var_os("NVM_BIN"),
		_ => None,
	};
	if let Some(root) = environment_root {
		let root = PathBuf::from(root);
		let path = if source == CcusageRuntimeSource::Bun {
			root.join("bin").join(file_name)
		} else {
			root.join(file_name)
		};
		push_unique(&mut paths, path);
	}
	if let Some(root) = std::env::var_os("VOLTA_HOME") {
		push_unique(
			&mut paths,
			PathBuf::from(root).join("bin").join(file_name),
		);
	}
	if let Some(home) = home {
		let relative_paths: &[&str] = match source {
			CcusageRuntimeSource::Bun => &[
				".bun/bin/bun",
				".volta/bin/bun",
				".local/bin/bun",
				".local/share/mise/shims/bun",
			],
			CcusageRuntimeSource::Npm => &[
				".volta/bin/npm",
				".local/bin/npm",
				".local/share/mise/shims/npm",
				".asdf/shims/npm",
			],
			_ => &[],
		};
		for relative in relative_paths {
			push_unique(&mut paths, home.join(relative));
		}
		if source == CcusageRuntimeSource::Npm {
			for path in nvm_npm_paths(home) {
				push_unique(&mut paths, path);
			}
		}
		#[cfg(target_os = "windows")]
		match source {
			CcusageRuntimeSource::Bun => {
				push_unique(&mut paths, home.join(".bun/bin/bun.exe"));
				push_unique(&mut paths, home.join(".volta/bin/bun.exe"));
			}
			CcusageRuntimeSource::Npm => {
				push_unique(&mut paths, home.join(".volta/bin/npm.cmd"));
			}
			_ => {}
		}
	}
	#[cfg(target_os = "macos")]
	for root in [Path::new("/opt/homebrew/bin"), Path::new("/usr/local/bin")] {
		push_unique(&mut paths, root.join(file_name));
	}
	#[cfg(target_os = "linux")]
	for root in [
		Path::new("/home/linuxbrew/.linuxbrew/bin"),
		Path::new("/usr/local/bin"),
	] {
		push_unique(&mut paths, root.join(file_name));
	}
	#[cfg(target_os = "windows")]
	{
		if source == CcusageRuntimeSource::Npm {
			if let Some(root) = std::env::var_os("APPDATA") {
				push_unique(
					&mut paths,
					PathBuf::from(root).join("npm/npm.cmd"),
				);
			}
			if let Some(root) = std::env::var_os("ProgramFiles") {
				push_unique(
					&mut paths,
					PathBuf::from(root).join("nodejs/npm.cmd"),
				);
			}
			if let Some(root) = std::env::var_os("NVM_SYMLINK") {
				push_unique(&mut paths, PathBuf::from(root).join("npm.cmd"));
			}
		}
	}
	paths
}

fn known_node_paths(home: Option<&Path>) -> Vec<PathBuf> {
	let mut paths = Vec::new();
	let file_name = node_file_name();
	if let Ok(path) = which::which("node") {
		push_unique(&mut paths, path);
	}
	if let Some(root) = std::env::var_os("VOLTA_HOME") {
		push_unique(
			&mut paths,
			PathBuf::from(root).join("bin").join(file_name),
		);
	}
	if let Some(home) = home {
		for relative in [
			".volta/bin",
			".local/bin",
			".local/share/mise/shims",
			".asdf/shims",
		] {
			push_unique(&mut paths, home.join(relative).join(file_name));
		}
	}
	#[cfg(target_os = "windows")]
	{
		if let Some(root) = std::env::var_os("ProgramFiles") {
			push_unique(
				&mut paths,
				PathBuf::from(root).join("nodejs/node.exe"),
			);
		}
		if let Some(root) = std::env::var_os("NVM_SYMLINK") {
			push_unique(&mut paths, PathBuf::from(root).join("node.exe"));
		}
	}
	paths
}

fn runner_from_path(
	source: CcusageRuntimeSource,
	path: PathBuf,
	node_candidates: &[PathBuf],
) -> Option<PackageRunner> {
	if !path.is_file() {
		return None;
	}
	if source == CcusageRuntimeSource::Npm {
		if let Some(runner) = node_backed_npm_runner(&path, node_candidates) {
			return Some(runner);
		}
	}
	if is_command_script(&path) {
		return None;
	}
	Some(PackageRunner::direct(path))
}

fn node_backed_npm_runner(
	npm: &Path,
	node_candidates: &[PathBuf],
) -> Option<PackageRunner> {
	let parent = npm.parent()?;
	let mut npm_cli_candidates = vec![
		parent.join("node_modules/npm/bin/npm-cli.js"),
		parent.join("../lib/node_modules/npm/bin/npm-cli.js"),
	];
	if npm
		.file_name()
		.and_then(|name| name.to_str())
		.is_some_and(|name| name.eq_ignore_ascii_case("npm-cli.js"))
	{
		push_unique(&mut npm_cli_candidates, npm.to_path_buf());
	}
	if let Ok(canonical) = npm.canonicalize() {
		if canonical
			.file_name()
			.and_then(|name| name.to_str())
			.is_some_and(|name| name.eq_ignore_ascii_case("npm-cli.js"))
		{
			push_unique(&mut npm_cli_candidates, canonical);
		}
	}
	let npm_cli = npm_cli_candidates
		.into_iter()
		.find(|candidate| candidate.is_file())?;
	let npm_cli = npm_cli.canonicalize().ok()?;
	let sibling_node = parent.join(node_file_name());
	let node = std::iter::once(sibling_node)
		.chain(node_candidates.iter().cloned())
		.find(|candidate| candidate.is_file())?;
	Some(PackageRunner::with_prefix(
		node,
		vec![npm_cli.into_os_string()],
	))
}

fn node_file_name() -> &'static str {
	if cfg!(target_os = "windows") {
		"node.exe"
	} else {
		"node"
	}
}

fn runner_file_name(source: CcusageRuntimeSource) -> &'static str {
	match source {
		CcusageRuntimeSource::Bun => {
			if cfg!(target_os = "windows") {
				"bun.exe"
			} else {
				"bun"
			}
		}
		CcusageRuntimeSource::Npm => {
			if cfg!(target_os = "windows") {
				"npm.cmd"
			} else {
				"npm"
			}
		}
		_ => "",
	}
}

fn nvm_npm_paths(home: &Path) -> Vec<PathBuf> {
	let versions = home.join(".nvm/versions/node");
	let Ok(entries) = std::fs::read_dir(versions) else {
		return Vec::new();
	};
	let mut versions = entries
		.filter_map(Result::ok)
		.filter_map(|entry| {
			let version = entry
				.file_name()
				.to_str()
				.and_then(|value| value.trim_start_matches('v').parse().ok())?;
			Some((version, entry.path().join("bin/npm")))
		})
		.collect::<Vec<(Version, PathBuf)>>();
	versions.sort_by(|left, right| right.0.cmp(&left.0));
	versions.into_iter().map(|(_, path)| path).collect()
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
	if !paths.contains(&path) {
		paths.push(path);
	}
}

fn is_command_script(path: &Path) -> bool {
	path.extension()
		.and_then(|extension| extension.to_str())
		.is_some_and(|extension| {
			extension.eq_ignore_ascii_case("cmd")
				|| extension.eq_ignore_ascii_case("bat")
		})
}

#[cfg(any(target_os = "windows", test))]
fn resolve_ccusage_command_script(
	command_script: &Path,
	platform_package: &str,
) -> Option<PathBuf> {
	let root = command_script.parent()?;
	[
		root.join("node_modules")
			.join(platform_package)
			.join("bin/ccusage.exe"),
		root.join("node_modules/ccusage/node_modules")
			.join(platform_package)
			.join("bin/ccusage.exe"),
	]
	.into_iter()
	.find(|candidate| candidate.is_file())
}

fn resolve_environment_path(
	path: PathBuf,
) -> Result<PathBuf, CcusageRuntimeError> {
	if path.is_file() {
		return Ok(path);
	}
	which::which(&path).map_err(|_| {
		CcusageRuntimeError::InvalidBinary(format!(
			"AGHUB_CCUSAGE_BIN does not resolve to a file: {}",
			path.display()
		))
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[cfg(unix)]
	fn descendant_probe_fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
		use std::os::unix::fs::PermissionsExt;

		let root = tempfile::tempdir().unwrap();
		let executable = root.path().join("ccusage");
		let marker = root.path().join("descendant-finished");
		let script = concat!(
			"#!/bin/sh\n",
			"marker=\"$(dirname \"$0\")/descendant-finished\"\n",
			"(sleep 0.5; printf leaked > \"$marker\") &\n",
			"wait\n",
		);
		std::fs::write(&executable, script).unwrap();
		std::fs::set_permissions(
			&executable,
			std::fs::Permissions::from_mode(0o755),
		)
		.unwrap();
		(root, executable, marker)
	}

	#[test]
	fn recognizes_windows_command_scripts() {
		assert!(is_command_script(Path::new("ccusage.cmd")));
		assert!(is_command_script(Path::new("CCUSAGE.BAT")));
		assert!(!is_command_script(Path::new("ccusage.exe")));
		assert!(!is_command_script(Path::new("ccusage")));
	}

	#[test]
	fn windows_ccusage_script_resolves_its_native_optional_package() {
		let root = tempfile::tempdir().unwrap();
		let command_script = root.path().join("ccusage.cmd");
		let native = root
			.path()
			.join("node_modules/@ccusage/ccusage-win32-x64/bin/ccusage.exe");
		std::fs::create_dir_all(native.parent().unwrap()).unwrap();
		std::fs::write(&command_script, b"fixture").unwrap();
		std::fs::write(&native, b"fixture").unwrap();

		assert_eq!(
			resolve_ccusage_command_script(
				&command_script,
				"@ccusage/ccusage-win32-x64",
			),
			Some(native)
		);
	}

	#[test]
	fn windows_ccusage_script_resolves_a_nested_optional_package() {
		let root = tempfile::tempdir().unwrap();
		let command_script = root.path().join("ccusage.cmd");
		let native = root
			.path()
			.join("node_modules/ccusage/node_modules")
			.join("@ccusage/ccusage-win32-arm64/bin/ccusage.exe");
		std::fs::create_dir_all(native.parent().unwrap()).unwrap();
		std::fs::write(&command_script, b"fixture").unwrap();
		std::fs::write(&native, b"fixture").unwrap();

		assert_eq!(
			resolve_ccusage_command_script(
				&command_script,
				"@ccusage/ccusage-win32-arm64",
			),
			Some(native)
		);
	}

	#[cfg(target_os = "macos")]
	#[test]
	fn includes_common_macos_gui_runner_paths() {
		let home = Path::new("/Users/example");
		let bun = known_runner_paths(CcusageRuntimeSource::Bun, Some(home));
		let npm = known_runner_paths(CcusageRuntimeSource::Npm, Some(home));

		assert!(bun.contains(&home.join(".bun/bin/bun")));
		assert!(bun.contains(&PathBuf::from("/opt/homebrew/bin/bun")));
		assert!(npm.contains(&PathBuf::from("/opt/homebrew/bin/npm")));
	}

	#[test]
	fn windows_npm_script_uses_node_without_a_shell() {
		let root = tempfile::tempdir().unwrap();
		let npm = root.path().join("npm.cmd");
		let node = root.path().join("node.exe");
		let npm_cli = root.path().join("node_modules/npm/bin/npm-cli.js");
		std::fs::create_dir_all(npm_cli.parent().unwrap()).unwrap();
		std::fs::write(&npm, b"fixture").unwrap();
		std::fs::write(&node, b"fixture").unwrap();
		std::fs::write(&npm_cli, b"fixture").unwrap();

		let runner = runner_from_path(
			CcusageRuntimeSource::Npm,
			npm,
			std::slice::from_ref(&node),
		)
		.unwrap();

		assert_eq!(runner.program, node);
		assert_eq!(
			runner.prefix_args,
			vec![npm_cli.canonicalize().unwrap().into_os_string()]
		);
	}

	#[cfg(unix)]
	#[test]
	fn unix_npm_layout_uses_the_adjacent_node_without_path_lookup() {
		let root = tempfile::tempdir().unwrap();
		let version = root.path().join("versions/node/v22.0.0");
		let npm = version.join("bin/npm");
		let node = version.join("bin/node");
		let npm_cli = version.join("lib/node_modules/npm/bin/npm-cli.js");
		std::fs::create_dir_all(npm.parent().unwrap()).unwrap();
		std::fs::create_dir_all(npm_cli.parent().unwrap()).unwrap();
		std::fs::write(&npm, b"#!/usr/bin/env node\n").unwrap();
		std::fs::write(&node, b"fixture").unwrap();
		std::fs::write(&npm_cli, b"fixture").unwrap();

		let runner =
			runner_from_path(CcusageRuntimeSource::Npm, npm, &[]).unwrap();

		assert_eq!(runner.program, node);
		assert_eq!(
			runner.prefix_args,
			vec![npm_cli.canonicalize().unwrap().into_os_string()]
		);
	}

	#[test]
	fn command_script_is_not_used_as_a_bun_runner() {
		let root = tempfile::tempdir().unwrap();
		let bun = root.path().join("bun.cmd");
		std::fs::write(&bun, b"fixture").unwrap();

		assert!(runner_from_path(CcusageRuntimeSource::Bun, bun, &[]).is_none());
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn version_timeout_stops_descendants() {
		let (_root, executable, marker) = descendant_probe_fixture();

		let error =
			probe_version_with_timeout(&executable, Duration::from_millis(50))
				.await
				.expect_err("version probe times out");
		assert!(matches!(
			error,
			CcusageRuntimeError::VersionProbeTimedOut(_)
		));
		tokio::time::sleep(Duration::from_millis(600)).await;
		assert!(!marker.exists());
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn version_probe_cancellation_stops_descendants() {
		let (_root, executable, marker) = descendant_probe_fixture();

		let result = tokio::time::timeout(
			Duration::from_millis(50),
			probe_version_with_timeout(&executable, Duration::from_secs(5)),
		)
		.await;
		assert!(result.is_err());
		tokio::time::sleep(Duration::from_millis(600)).await;
		assert!(!marker.exists());
	}
}

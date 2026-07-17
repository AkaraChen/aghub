//! Binary provisioning: download a pinned CLIProxyAPI release, verify its
//! sha256 against the published `checksums.txt`, extract, and locate the
//! executable.
//!
//! Runtime download (instead of bundling via Tauri `externalBin`) keeps the
//! app small and decouples aghub releases from CLIProxyAPI's near-daily
//! cadence. `AGHUB_CLIPROXY_DOWNLOAD_BASE` overrides the release host for
//! mirrors; `AGHUB_CLIPROXY_BIN` bypasses provisioning entirely with a
//! local binary. Extraction shells out to `tar`, which handles `.tar.gz`
//! everywhere and `.zip` on Windows (bsdtar).

use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::Digest;

use crate::dto::GatewayProvisionPhase;
use crate::error::{GatewayError, Result};

/// The CLIProxyAPI release this aghub build was validated against.
/// Upgrades are explicit: bump after re-running the management contract
/// tests against the new release.
pub const PINNED_VERSION: &str = "7.2.81";

const DEFAULT_DOWNLOAD_BASE: &str =
	"https://github.com/router-for-me/CLIProxyAPI/releases/download";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);
const EXTRACT_TIMEOUT: Duration = Duration::from_secs(60);

/// Release host resolution: explicit mirror (settings UI) → env override →
/// GitHub. A mirror serves the same `releases/download/v…/asset` layout.
pub fn download_base(mirror: Option<&str>) -> String {
	mirror
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.map(|value| value.trim_end_matches('/').to_string())
		.or_else(|| {
			std::env::var("AGHUB_CLIPROXY_DOWNLOAD_BASE")
				.ok()
				.map(|value| value.trim().trim_end_matches('/').to_string())
				.filter(|value| !value.is_empty())
		})
		.unwrap_or_else(|| DEFAULT_DOWNLOAD_BASE.to_string())
}

fn release_os() -> Result<&'static str> {
	match std::env::consts::OS {
		"macos" => Ok("darwin"),
		"linux" => Ok("linux"),
		"windows" => Ok("windows"),
		other => Err(GatewayError::Download(format!(
			"unsupported platform for CLIProxyAPI: {other}"
		))),
	}
}

fn release_arch() -> Result<&'static str> {
	match std::env::consts::ARCH {
		"x86_64" => Ok("amd64"),
		"aarch64" => Ok("aarch64"),
		other => Err(GatewayError::Download(format!(
			"unsupported architecture for CLIProxyAPI: {other}"
		))),
	}
}

/// e.g. `CLIProxyAPI_7.2.81_darwin_aarch64.tar.gz`
pub fn asset_name(version: &str) -> Result<String> {
	let extension = if std::env::consts::OS == "windows" {
		"zip"
	} else {
		"tar.gz"
	};
	Ok(format!(
		"CLIProxyAPI_{version}_{os}_{arch}.{extension}",
		os = release_os()?,
		arch = release_arch()?,
	))
}

fn version_dir(root: &Path, version: &str) -> PathBuf {
	root.join("bin").join(version)
}

/// Locate the provisioned binary. `AGHUB_CLIPROXY_BIN` (dev/offline) wins
/// over the versioned install directory.
pub fn installed_bin(root: &Path, version: &str) -> Option<PathBuf> {
	if let Some(explicit) = std::env::var_os("AGHUB_CLIPROXY_BIN") {
		let path = PathBuf::from(explicit);
		if path.is_file() {
			return Some(path);
		}
	}
	find_executable(&version_dir(root, version))
}

/// Pick the executable out of an extracted release directory: the sole
/// regular file that is not a doc/config leftover.
fn find_executable(dir: &Path) -> Option<PathBuf> {
	const SKIP_EXTENSIONS: &[&str] =
		&["txt", "md", "yaml", "yml", "example", "json", "license"];
	let entries = std::fs::read_dir(dir).ok()?;
	let mut candidates: Vec<PathBuf> = entries
		.filter_map(|entry| entry.ok().map(|entry| entry.path()))
		.filter(|path| path.is_file())
		.filter(|path| {
			let extension = path
				.extension()
				.and_then(|extension| extension.to_str())
				.map(str::to_ascii_lowercase);
			match extension.as_deref() {
				Some(extension) => !SKIP_EXTENSIONS.contains(&extension),
				None => true,
			}
		})
		.collect();
	if candidates.len() > 1 {
		candidates.retain(|path| {
			path.file_name()
				.and_then(|name| name.to_str())
				.map(|name| name.to_ascii_lowercase().contains("proxy"))
				.unwrap_or(false)
		});
	}
	candidates.into_iter().next()
}

/// Download + verify + extract `version` under `<root>/bin/<version>/`.
/// `progress` receives phase transitions and download percentage.
pub async fn provision(
	root: &Path,
	version: &str,
	mirror: Option<&str>,
	progress: impl Fn(GatewayProvisionPhase, Option<u8>),
) -> Result<PathBuf> {
	let asset = asset_name(version)?;
	let base = download_base(mirror);
	let http = reqwest::Client::builder()
		.connect_timeout(Duration::from_secs(10))
		.timeout(DOWNLOAD_TIMEOUT)
		.build()?;

	progress(GatewayProvisionPhase::Downloading, Some(0));
	let checksums = http
		.get(format!("{base}/v{version}/checksums.txt"))
		.send()
		.await?
		.error_for_status()
		.map_err(|error| {
			GatewayError::Download(format!(
				"checksums.txt for v{version}: {error}"
			))
		})?
		.text()
		.await?;
	let expected = checksums
		.lines()
		.find_map(|line| {
			let mut parts = line.split_whitespace();
			let hash = parts.next()?;
			let name = parts.next()?;
			(name.trim_start_matches('*') == asset)
				.then(|| hash.to_ascii_lowercase())
		})
		.ok_or_else(|| {
			GatewayError::Download(format!(
				"asset {asset} not listed in checksums.txt"
			))
		})?;

	let response = http
		.get(format!("{base}/v{version}/{asset}"))
		.send()
		.await?
		.error_for_status()
		.map_err(|error| GatewayError::Download(format!("{asset}: {error}")))?;
	let total = response.content_length();

	let dir = version_dir(root, version);
	std::fs::create_dir_all(&dir)?;
	let archive_path = dir.join(&asset);
	let mut file = tokio::fs::File::create(&archive_path).await?;
	let mut hasher = sha2::Sha256::new();
	let mut downloaded: u64 = 0;
	let mut response = response;
	while let Some(chunk) = response.chunk().await? {
		hasher.update(&chunk);
		tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
		downloaded += chunk.len() as u64;
		if let Some(total) = total.filter(|total| *total > 0) {
			let percent = ((downloaded * 100) / total).min(100) as u8;
			progress(GatewayProvisionPhase::Downloading, Some(percent));
		}
	}
	tokio::io::AsyncWriteExt::flush(&mut file).await?;
	drop(file);

	let actual = format!("{:x}", hasher.finalize());
	if actual != expected {
		let _ = std::fs::remove_file(&archive_path);
		return Err(GatewayError::ChecksumMismatch(asset));
	}

	progress(GatewayProvisionPhase::Extracting, None);
	extract(&archive_path, &dir).await?;
	let _ = std::fs::remove_file(&archive_path);

	let bin = find_executable(&dir).ok_or_else(|| {
		GatewayError::Extract(format!(
			"no executable found in extracted release at {}",
			dir.display()
		))
	})?;
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755))?;
	}
	progress(GatewayProvisionPhase::Ready, None);
	Ok(bin)
}

/// `tar -xf` handles `.tar.gz` on macOS/Linux and both formats on Windows
/// 10+ (bsdtar).
async fn extract(archive: &Path, dest: &Path) -> Result<()> {
	let mut command = tokio::process::Command::new("tar");
	command
		.arg("-xf")
		.arg(archive)
		.arg("-C")
		.arg(dest)
		.kill_on_drop(true);
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		command.creation_flags(crate::lifecycle::CREATE_NO_WINDOW);
	}
	let output = tokio::time::timeout(EXTRACT_TIMEOUT, command.output())
		.await
		.map_err(|_| {
			GatewayError::Extract("tar timed out after 60s".to_string())
		})?
		.map_err(|error| {
			GatewayError::Extract(format!("failed to spawn tar: {error}"))
		})?;
	if !output.status.success() {
		return Err(GatewayError::Extract(format!(
			"tar exited with {}: {}",
			output.status,
			String::from_utf8_lossy(&output.stderr)
		)));
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn asset_name_matches_release_convention() {
		let name = asset_name("7.2.81").expect("asset name");
		assert!(name.starts_with("CLIProxyAPI_7.2.81_"));
		#[cfg(target_os = "macos")]
		assert!(name.contains("_darwin_"));
		#[cfg(not(target_os = "windows"))]
		assert!(name.ends_with(".tar.gz"));
	}

	#[test]
	fn find_executable_skips_docs_and_prefers_proxy_name() {
		let dir = tempfile::tempdir().expect("tempdir");
		std::fs::write(dir.path().join("README.md"), "doc").unwrap();
		std::fs::write(dir.path().join("config.example.yaml"), "cfg").unwrap();
		std::fs::write(dir.path().join("cli-proxy-api"), "bin").unwrap();
		let found = find_executable(dir.path()).expect("executable");
		assert_eq!(
			found.file_name().and_then(|name| name.to_str()),
			Some("cli-proxy-api")
		);
	}

	#[test]
	fn installed_bin_honors_env_override() {
		let dir = tempfile::tempdir().expect("tempdir");
		let bin = dir.path().join("custom-cliproxy");
		std::fs::write(&bin, "bin").unwrap();
		std::env::set_var("AGHUB_CLIPROXY_BIN", &bin);
		let found = installed_bin(dir.path(), "0.0.0");
		std::env::remove_var("AGHUB_CLIPROXY_BIN");
		assert_eq!(found, Some(bin));
	}
}

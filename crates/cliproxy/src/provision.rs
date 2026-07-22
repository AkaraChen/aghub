//! Binary provisioning: download a pinned CLIProxyAPI release, verify its
//! sha256 against the checksum pinned from the published `checksums.txt`,
//! extract, and locate the executable.
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
// v7.2.81's largest supported archive is 15,325,274 bytes. This leaves more
// than four times that size for release growth without allowing unbounded data.
const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;

fn archive_size_after_chunk(downloaded: u64, chunk_size: usize) -> Result<u64> {
	let chunk_size = u64::try_from(chunk_size).map_err(|_| {
		GatewayError::Download(
			"archive chunk size does not fit in u64".to_string(),
		)
	})?;
	let size = downloaded.checked_add(chunk_size).ok_or_else(|| {
		GatewayError::Download("archive download size overflowed".to_string())
	})?;
	if size > MAX_ARCHIVE_BYTES {
		return Err(GatewayError::Download(
			"archive exceeds the 64 MiB download limit".to_string(),
		));
	}
	Ok(size)
}

/// SHA-256 values copied from the pinned release's published checksums.
/// Bump these in the same change as [`PINNED_VERSION`].
fn expected_checksum(version: &str, asset: &str) -> Result<&'static str> {
	if version != PINNED_VERSION {
		return Err(GatewayError::Download(format!(
			"no trusted checksum is pinned for CLIProxyAPI v{version}"
		)));
	}
	match asset {
		"CLIProxyAPI_7.2.81_darwin_aarch64.tar.gz" => Ok(
			"c48e80b51973f3102f7eac78c32be9bcfcde0dad48aa940d0bc2ee7052fa741a",
		),
		"CLIProxyAPI_7.2.81_darwin_amd64.tar.gz" => Ok(
			"75af5e17e4d211422d1dadf37dbfe715c2c8acad5b9784afe25ed5394e238376",
		),
		"CLIProxyAPI_7.2.81_linux_aarch64.tar.gz" => Ok(
			"861a8fd33f6f57945d29e632ab4cca826a69649bc37be1fbccfaef0fd019f889",
		),
		"CLIProxyAPI_7.2.81_linux_amd64.tar.gz" => Ok(
			"9a21b417e76c94267f747357bb83f87c8e9fccd5b15cbf8c3a8b3de1418a6472",
		),
		"CLIProxyAPI_7.2.81_windows_aarch64.zip" => Ok(
			"83e67f73ae622d1a1eb93655aca67521c68e6d1ba8e1713bdb36c8487819ad91",
		),
		"CLIProxyAPI_7.2.81_windows_amd64.zip" => Ok(
			"46f1aeddc8eddaf6c4369e0e9c7307ca3348c6d846b59ad26f1d8d038e8fad6b",
		),
		_ => Err(GatewayError::Download(format!(
			"no trusted checksum is pinned for {asset}"
		))),
	}
}

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
/// over the versioned install directory. A `cli-proxy-api` on PATH is
/// deliberately NOT used here: package-manager installs are surfaced via
/// [`system_bin`] as information only — silently running an unpinned
/// binary would break the version contract.
pub fn installed_bin(root: &Path, version: &str) -> Option<PathBuf> {
	if let Some(explicit) = std::env::var_os("AGHUB_CLIPROXY_BIN") {
		let path = PathBuf::from(explicit);
		if path.is_file() {
			return Some(path);
		}
	}
	find_executable(&version_dir(root, version))
}

/// Where the binary `installed_bin` resolves to comes from.
pub fn bin_source(root: &Path, version: &str) -> crate::dto::GatewayBinSource {
	if std::env::var_os("AGHUB_CLIPROXY_BIN")
		.map(PathBuf::from)
		.filter(|path| path.is_file())
		.is_some()
	{
		return crate::dto::GatewayBinSource::Env;
	}
	if find_executable(&version_dir(root, version)).is_some() {
		return crate::dto::GatewayBinSource::Downloaded;
	}
	crate::dto::GatewayBinSource::None
}

/// A `cli-proxy-api` found on PATH (brew/pacman/manual installs), shown
/// to macOS/Linux users who prefer their package manager. Opting in is
/// explicit via `AGHUB_CLIPROXY_BIN`.
pub fn system_bin() -> Option<PathBuf> {
	which::which("cli-proxy-api").ok()
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
	let expected = expected_checksum(version, &asset)?;
	let base = download_base(mirror);
	let http = reqwest::Client::builder()
		.connect_timeout(Duration::from_secs(10))
		.timeout(DOWNLOAD_TIMEOUT)
		.build()?;

	progress(GatewayProvisionPhase::Downloading, Some(0));
	let response = http
		.get(format!("{base}/v{version}/{asset}"))
		.send()
		.await?
		.error_for_status()
		.map_err(|error| GatewayError::Download(format!("{asset}: {error}")))?;
	let total = response.content_length();
	if total.is_some_and(|size| size > MAX_ARCHIVE_BYTES) {
		return Err(GatewayError::Download(format!(
			"{asset} exceeds the 64 MiB download limit"
		)));
	}

	let dir = version_dir(root, version);
	std::fs::create_dir_all(&dir)?;
	let temporary = tempfile::Builder::new()
		.prefix(".download.")
		.suffix(&format!(".{asset}"))
		.tempfile_in(&dir)?;
	let archive_path = temporary.path().to_path_buf();
	let mut file = tokio::fs::File::from_std(temporary.reopen()?);
	let mut hasher = sha2::Sha256::new();
	let mut downloaded: u64 = 0;
	let mut response = response;
	while let Some(chunk) = response.chunk().await? {
		downloaded = archive_size_after_chunk(downloaded, chunk.len())?;
		hasher.update(&chunk);
		tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
		if let Some(total) = total.filter(|total| *total > 0) {
			let percent = ((downloaded * 100) / total).min(100) as u8;
			progress(GatewayProvisionPhase::Downloading, Some(percent));
		}
	}
	tokio::io::AsyncWriteExt::flush(&mut file).await?;
	drop(file);

	let actual = format!("{:x}", hasher.finalize());
	if actual != expected {
		return Err(GatewayError::ChecksumMismatch(asset));
	}

	progress(GatewayProvisionPhase::Extracting, None);
	extract(&archive_path, &dir).await?;
	drop(temporary);

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
			// Windows only grew a bundled bsdtar in 10 1803; older hosts
			// need the actionable hint, not a bare NotFound.
			if cfg!(windows) && error.kind() == std::io::ErrorKind::NotFound {
				GatewayError::Extract(
					"tar.exe not found; Windows 10 1803+ ships it — on \
					 older systems extract the archive manually and point \
					 AGHUB_CLIPROXY_BIN at the binary"
						.to_string(),
				)
			} else {
				GatewayError::Extract(format!("failed to spawn tar: {error}"))
			}
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

	#[test]
	fn archive_size_limit_rejects_oversized_streams() {
		assert!(archive_size_after_chunk(MAX_ARCHIVE_BYTES, 1).is_err());
	}

	#[test]
	fn checksum_is_tied_to_the_pinned_version() {
		let asset = asset_name(PINNED_VERSION).expect("asset name");
		let checksum =
			expected_checksum(PINNED_VERSION, &asset).expect("pinned checksum");
		assert_eq!(checksum.len(), 64);
		assert!(expected_checksum("7.2.82", &asset).is_err());
	}
}

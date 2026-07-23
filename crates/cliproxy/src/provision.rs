//! Binary provisioning: download a pinned CLIProxyAPI release, verify its
//! sha256 against the checksum pinned from the published `checksums.txt`,
//! extract, and locate the executable.
//!
//! Runtime download (instead of bundling via Tauri `externalBin`) keeps the
//! app small and decouples aghub releases from CLIProxyAPI's near-daily
//! cadence. `AGHUB_CLIPROXY_DOWNLOAD_BASE` overrides the release host for
//! mirrors; `AGHUB_CLIPROXY_BIN` bypasses provisioning entirely with a
//! local binary. Archives are unpacked in-process into a staging directory
//! and only become visible after the verified install is committed.

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
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
// v7.2.81's largest supported archive is 15,325,274 bytes. This leaves more
// than four times that size for release growth without allowing unbounded data.
const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
// v7.2.81 expands to less than 40 MiB and contains fewer than 20 entries.
// These limits leave room for release growth while bounding decompression.
const MAX_EXTRACTED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 256;
const MAX_ARCHIVE_PATH_DEPTH: usize = 16;
const INSTALL_MANIFEST: &str = ".aghub-install.json";

#[derive(Debug, Serialize, Deserialize)]
struct InstallManifest {
	version: String,
	asset: String,
	sha256: String,
	executable: PathBuf,
}

#[derive(Debug, Clone, Copy)]
enum ArchiveFormat {
	TarGz,
	Zip,
}

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

fn next_download_percent(
	downloaded: u64,
	total: u64,
	last_percent: &mut u8,
) -> Option<u8> {
	if total == 0 {
		return None;
	}
	let percent = ((downloaded * 100) / total).min(100) as u8;
	if percent == *last_percent {
		return None;
	}
	*last_percent = percent;
	Some(percent)
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

fn archive_format(asset: &str) -> Result<ArchiveFormat> {
	if asset.ends_with(".tar.gz") {
		return Ok(ArchiveFormat::TarGz);
	}
	if asset.ends_with(".zip") {
		return Ok(ArchiveFormat::Zip);
	}
	Err(GatewayError::Extract(format!(
		"unsupported release archive format: {asset}"
	)))
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
	validated_install_bin(&version_dir(root, version), version)
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
	if validated_install_bin(&version_dir(root, version), version).is_some() {
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
	let mut files = Vec::new();
	collect_regular_files(dir, 0, &mut files).ok()?;
	let mut candidates: Vec<PathBuf> = files
		.into_iter()
		.filter(|path| {
			path.file_name()
				.is_some_and(|name| name != INSTALL_MANIFEST)
		})
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

fn collect_regular_files(
	dir: &Path,
	depth: usize,
	files: &mut Vec<PathBuf>,
) -> std::io::Result<()> {
	if depth > MAX_ARCHIVE_PATH_DEPTH {
		return Ok(());
	}
	for entry in std::fs::read_dir(dir)? {
		let entry = entry?;
		let file_type = entry.file_type()?;
		if file_type.is_symlink() {
			continue;
		}
		if file_type.is_dir() {
			collect_regular_files(&entry.path(), depth + 1, files)?;
		} else if file_type.is_file() {
			files.push(entry.path());
		}
	}
	Ok(())
}

fn validated_install_bin(dir: &Path, version: &str) -> Option<PathBuf> {
	let manifest: InstallManifest = serde_json::from_slice(
		&std::fs::read(dir.join(INSTALL_MANIFEST)).ok()?,
	)
	.ok()?;
	if manifest.version != version
		|| expected_checksum(version, &manifest.asset).ok()? != manifest.sha256
	{
		return None;
	}
	if manifest.executable.as_os_str().is_empty()
		|| manifest
			.executable
			.components()
			.any(|component| !matches!(component, Component::Normal(_)))
	{
		return None;
	}
	let binary = dir.join(manifest.executable);
	let metadata = std::fs::symlink_metadata(&binary).ok()?;
	(metadata.file_type().is_file() && !metadata.file_type().is_symlink())
		.then_some(binary)
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
	reconcile_installation(root, version)?;
	if let Some(binary) = installed_bin(root, version) {
		progress(GatewayProvisionPhase::Ready, None);
		return Ok(binary);
	}
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

	let bin_root = root.join("bin");
	std::fs::create_dir_all(&bin_root)?;
	let staging = tempfile::Builder::new()
		.prefix(&format!(".{version}.staging."))
		.tempdir_in(&bin_root)?;
	let temporary = tempfile::Builder::new()
		.prefix(".download.")
		.suffix(&format!(".{asset}"))
		.tempfile_in(staging.path())?;
	let archive_path = temporary.path().to_path_buf();
	let mut file = tokio::fs::File::from_std(temporary.reopen()?);
	let mut hasher = sha2::Sha256::new();
	let mut downloaded: u64 = 0;
	let mut last_percent = 0;
	let mut response = response;
	while let Some(chunk) = response.chunk().await? {
		downloaded = archive_size_after_chunk(downloaded, chunk.len())?;
		hasher.update(&chunk);
		tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
		if let Some(total) = total.filter(|total| *total > 0) {
			if let Some(percent) =
				next_download_percent(downloaded, total, &mut last_percent)
			{
				progress(GatewayProvisionPhase::Downloading, Some(percent));
			}
		}
	}
	tokio::io::AsyncWriteExt::flush(&mut file).await?;
	drop(file);

	let actual = format!("{:x}", hasher.finalize());
	if actual != expected {
		return Err(GatewayError::ChecksumMismatch(asset));
	}

	progress(GatewayProvisionPhase::Extracting, None);
	let payload = staging.path().join("payload");
	std::fs::create_dir(&payload)?;
	extract(&archive_path, &payload, archive_format(&asset)?).await?;
	drop(temporary);

	let bin = find_executable(&payload).ok_or_else(|| {
		GatewayError::Extract(format!(
			"no executable found in extracted release at {}",
			payload.display()
		))
	})?;
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755))?;
	}
	let executable = bin.strip_prefix(&payload).map_err(|error| {
		GatewayError::Extract(format!(
			"executable escaped the staging directory: {error}"
		))
	})?;
	write_install_manifest(&payload, version, &asset, expected, executable)?;
	commit_install(&payload, &version_dir(root, version), version)?;
	let bin = validated_install_bin(&version_dir(root, version), version)
		.ok_or_else(|| {
			GatewayError::Extract(
				"committed install failed manifest validation".to_string(),
			)
		})?;
	progress(GatewayProvisionPhase::Ready, None);
	Ok(bin)
}

fn write_install_manifest(
	dir: &Path,
	version: &str,
	asset: &str,
	checksum: &str,
	executable: &Path,
) -> Result<()> {
	let manifest = InstallManifest {
		version: version.to_string(),
		asset: asset.to_string(),
		sha256: checksum.to_string(),
		executable: executable.to_path_buf(),
	};
	let mut file = std::fs::File::create(dir.join(INSTALL_MANIFEST))?;
	serde_json::to_writer_pretty(&mut file, &manifest)?;
	file.write_all(b"\n")?;
	file.sync_all()?;
	Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> std::io::Result<()> {
	std::fs::File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> std::io::Result<()> {
	Ok(())
}

fn commit_install(
	payload: &Path,
	destination: &Path,
	version: &str,
) -> Result<()> {
	let parent = destination.parent().ok_or_else(|| {
		GatewayError::Extract("install destination has no parent".to_string())
	})?;
	let backup = parent.join(format!(
		".{version}.replaced.{}",
		uuid::Uuid::new_v4().simple()
	));
	let had_destination = destination.exists();
	if had_destination {
		std::fs::rename(destination, &backup)?;
	}
	if let Err(error) = std::fs::rename(payload, destination) {
		if had_destination {
			let _ = std::fs::rename(&backup, destination);
			let _ = sync_directory(parent);
		}
		return Err(GatewayError::Extract(format!(
			"failed to commit extracted release: {error}"
		)));
	}
	sync_directory(parent)?;
	if had_destination {
		if let Err(error) = std::fs::remove_dir_all(&backup) {
			log::warn!(
				"failed to remove replaced gateway install at {}: {error}",
				backup.display()
			);
		}
	}
	sync_directory(parent)?;
	Ok(())
}

/// Remove abandoned staging directories and recover a previously committed
/// install if a process stopped between the two rename operations.
pub fn reconcile_installation(root: &Path, version: &str) -> Result<()> {
	let bin_root = root.join("bin");
	if !bin_root.exists() {
		return Ok(());
	}
	let destination = version_dir(root, version);
	let staging_prefix = format!(".{version}.staging.");
	let backup_prefix = format!(".{version}.replaced.");
	let mut backups = Vec::new();
	for entry in std::fs::read_dir(&bin_root)? {
		let entry = entry?;
		if !entry.file_type()?.is_dir() {
			continue;
		}
		let name = entry.file_name();
		let name = name.to_string_lossy();
		if name.starts_with(&staging_prefix) {
			std::fs::remove_dir_all(entry.path())?;
		} else if name.starts_with(&backup_prefix) {
			backups.push(entry.path());
		}
	}
	if validated_install_bin(&destination, version).is_some() {
		for backup in backups {
			std::fs::remove_dir_all(backup)?;
		}
		sync_directory(&bin_root)?;
		return Ok(());
	}
	let recoverable = backups
		.iter()
		.find(|backup| validated_install_bin(backup, version).is_some())
		.cloned();
	if let Some(backup) = recoverable {
		if destination.exists() {
			std::fs::remove_dir_all(&destination)?;
		}
		std::fs::rename(&backup, &destination)?;
	}
	for backup in backups {
		if backup.exists() {
			std::fs::remove_dir_all(backup)?;
		}
	}
	sync_directory(&bin_root)?;
	Ok(())
}

async fn extract(
	archive: &Path,
	dest: &Path,
	format: ArchiveFormat,
) -> Result<()> {
	let archive = archive.to_path_buf();
	let dest = dest.to_path_buf();
	tokio::task::spawn_blocking(move || match format {
		ArchiveFormat::TarGz => extract_tar_gz(&archive, &dest),
		ArchiveFormat::Zip => extract_zip(&archive, &dest),
	})
	.await
	.map_err(|error| {
		GatewayError::Extract(format!(
			"archive extraction task failed: {error}"
		))
	})?
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<()> {
	let file = std::fs::File::open(archive)?;
	let decoder = flate2::read::GzDecoder::new(file);
	let mut archive = tar::Archive::new(decoder);
	let mut extracted = 0_u64;
	for (index, entry) in archive.entries()?.enumerate() {
		if index >= MAX_ARCHIVE_ENTRIES {
			return Err(GatewayError::Extract(format!(
				"archive exceeds the {MAX_ARCHIVE_ENTRIES}-entry limit"
			)));
		}
		let mut entry = entry.map_err(|error| {
			GatewayError::Extract(format!("invalid tar entry: {error}"))
		})?;
		let entry_type = entry.header().entry_type();
		if !entry_type.is_file() && !entry_type.is_dir() {
			return Err(GatewayError::Extract(format!(
				"unsupported tar entry type for {}",
				entry.path()?.display()
			)));
		}
		let relative = safe_archive_path(&entry.path()?)?;
		let target = dest.join(relative);
		if entry_type.is_dir() {
			std::fs::create_dir_all(target)?;
			continue;
		}
		let size = entry.size();
		extracted = checked_extracted_size(extracted, size)?;
		write_archive_file(&mut entry, &target, size)?;
	}
	Ok(())
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<()> {
	let file = std::fs::File::open(archive)?;
	let mut archive = zip::ZipArchive::new(file).map_err(|error| {
		GatewayError::Extract(format!("invalid zip archive: {error}"))
	})?;
	if archive.len() > MAX_ARCHIVE_ENTRIES {
		return Err(GatewayError::Extract(format!(
			"archive exceeds the {MAX_ARCHIVE_ENTRIES}-entry limit"
		)));
	}
	let mut extracted = 0_u64;
	for index in 0..archive.len() {
		let mut entry = archive.by_index(index).map_err(|error| {
			GatewayError::Extract(format!("invalid zip entry: {error}"))
		})?;
		if let Some(mode) = entry.unix_mode() {
			let file_type = mode & 0o170000;
			let expected = if entry.is_dir() { 0o040000 } else { 0o100000 };
			if file_type != 0 && file_type != expected {
				return Err(GatewayError::Extract(format!(
					"unsupported zip entry type for {}",
					entry.name()
				)));
			}
		}
		let relative = safe_archive_name(entry.name())?;
		let target = dest.join(relative);
		if entry.is_dir() {
			std::fs::create_dir_all(target)?;
			continue;
		}
		let size = entry.size();
		extracted = checked_extracted_size(extracted, size)?;
		write_archive_file(&mut entry, &target, size)?;
	}
	Ok(())
}

fn safe_archive_path(path: &Path) -> Result<PathBuf> {
	let name = path.to_str().ok_or_else(|| {
		GatewayError::Extract("archive entry path is not UTF-8".to_string())
	})?;
	safe_archive_name(name)
}

fn safe_archive_name(name: &str) -> Result<PathBuf> {
	if name.is_empty()
		|| name.starts_with('/')
		|| name.contains('\\')
		|| name.contains('\0')
	{
		return Err(GatewayError::Extract(format!(
			"unsafe archive path: {name:?}"
		)));
	}
	let mut path = PathBuf::new();
	for part in name.split('/') {
		if part.is_empty() {
			continue;
		}
		if part == "." {
			continue;
		}
		if part == ".." || part.contains(':') {
			return Err(GatewayError::Extract(format!(
				"unsafe archive path: {name:?}"
			)));
		}
		path.push(part);
		if path.components().count() > MAX_ARCHIVE_PATH_DEPTH {
			return Err(GatewayError::Extract(format!(
				"archive path exceeds the {MAX_ARCHIVE_PATH_DEPTH}-level \
				 limit: {name:?}"
			)));
		}
	}
	if path.as_os_str().is_empty()
		|| path
			.components()
			.any(|component| !matches!(component, Component::Normal(_)))
	{
		return Err(GatewayError::Extract(format!(
			"unsafe archive path: {name:?}"
		)));
	}
	Ok(path)
}

fn checked_extracted_size(current: u64, entry_size: u64) -> Result<u64> {
	let total = current.checked_add(entry_size).ok_or_else(|| {
		GatewayError::Extract("extracted size overflowed".to_string())
	})?;
	if total > MAX_EXTRACTED_BYTES {
		return Err(GatewayError::Extract(format!(
			"archive exceeds the {} MiB extraction limit",
			MAX_EXTRACTED_BYTES / (1024 * 1024)
		)));
	}
	Ok(total)
}

fn write_archive_file(
	reader: &mut impl Read,
	target: &Path,
	expected_size: u64,
) -> Result<()> {
	let parent = target.parent().ok_or_else(|| {
		GatewayError::Extract(format!(
			"archive target has no parent: {}",
			target.display()
		))
	})?;
	std::fs::create_dir_all(parent)?;
	let mut output = std::fs::OpenOptions::new()
		.write(true)
		.create_new(true)
		.open(target)?;
	let actual =
		std::io::copy(&mut reader.take(expected_size + 1), &mut output)?;
	if actual != expected_size {
		return Err(GatewayError::Extract(format!(
			"archive entry size mismatch for {}: expected {expected_size}, \
			 wrote {actual}",
			target.display()
		)));
	}
	output.sync_all()?;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn committed_install(dir: &Path) -> PathBuf {
		let install = dir.join("payload");
		std::fs::create_dir_all(&install).expect("install directory");
		let binary = install.join("cli-proxy-api");
		std::fs::write(&binary, "binary").expect("binary");
		let asset = asset_name(PINNED_VERSION).expect("asset name");
		let checksum =
			expected_checksum(PINNED_VERSION, &asset).expect("checksum");
		write_install_manifest(
			&install,
			PINNED_VERSION,
			&asset,
			checksum,
			Path::new("cli-proxy-api"),
		)
		.expect("manifest");
		install
	}

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
	fn installed_bin_rejects_uncommitted_directory() {
		let dir = tempfile::tempdir().expect("tempdir");
		let install = version_dir(dir.path(), PINNED_VERSION);
		std::fs::create_dir_all(&install).expect("install directory");
		std::fs::write(install.join("cli-proxy-api"), "partial")
			.expect("partial binary");

		assert_eq!(installed_bin(dir.path(), PINNED_VERSION), None);
	}

	#[test]
	fn installed_bin_accepts_committed_directory() {
		let dir = tempfile::tempdir().expect("tempdir");
		let install = committed_install(dir.path());
		let destination = version_dir(dir.path(), PINNED_VERSION);
		std::fs::create_dir_all(destination.parent().expect("bin root"))
			.expect("bin root");
		std::fs::rename(install, &destination).expect("commit");

		assert_eq!(
			installed_bin(dir.path(), PINNED_VERSION),
			Some(destination.join("cli-proxy-api"))
		);
	}

	#[test]
	fn archive_paths_reject_cross_platform_escapes() {
		assert!(safe_archive_name("../escape").is_err());
		assert!(safe_archive_name("dir/../../escape").is_err());
		assert!(safe_archive_name("/absolute").is_err());
		assert!(safe_archive_name(r"dir\..\escape").is_err());
		assert!(safe_archive_name("C:/escape").is_err());
	}

	#[test]
	fn tar_links_are_rejected() {
		let dir = tempfile::tempdir().expect("tempdir");
		let archive_path = dir.path().join("release.tar.gz");
		let file = std::fs::File::create(&archive_path).expect("archive");
		let encoder =
			flate2::write::GzEncoder::new(file, flate2::Compression::default());
		let mut archive = tar::Builder::new(encoder);
		let mut header = tar::Header::new_gnu();
		header.set_entry_type(tar::EntryType::Symlink);
		header.set_size(0);
		header.set_mode(0o777);
		header.set_link_name("../outside").expect("link target");
		header.set_cksum();
		archive
			.append_data(&mut header, "cli-proxy-api", std::io::empty())
			.expect("symlink entry");
		archive.into_inner().expect("tar").finish().expect("gzip");
		let output = dir.path().join("output");
		std::fs::create_dir(&output).expect("output");

		assert!(extract_tar_gz(&archive_path, &output).is_err());
		assert!(!output.join("cli-proxy-api").exists());
	}

	#[test]
	fn reconciliation_recovers_committed_backup() {
		let dir = tempfile::tempdir().expect("tempdir");
		let bin_root = dir.path().join("bin");
		std::fs::create_dir(&bin_root).expect("bin root");
		let backup = bin_root.join(format!(".{PINNED_VERSION}.replaced.test"));
		std::fs::rename(committed_install(dir.path()), &backup)
			.expect("backup");
		let staging = bin_root.join(format!(".{PINNED_VERSION}.staging.test"));
		std::fs::create_dir(&staging).expect("staging");

		reconcile_installation(dir.path(), PINNED_VERSION).expect("reconcile");

		assert!(installed_bin(dir.path(), PINNED_VERSION).is_some());
		assert!(!backup.exists());
		assert!(!staging.exists());
	}

	#[test]
	fn archive_size_limit_rejects_oversized_streams() {
		assert!(archive_size_after_chunk(MAX_ARCHIVE_BYTES, 1).is_err());
	}

	#[test]
	fn download_progress_only_emits_changed_percentages() {
		let mut last_percent = 0;

		assert_eq!(next_download_percent(1, 1_000, &mut last_percent), None);
		assert_eq!(
			next_download_percent(10, 1_000, &mut last_percent),
			Some(1)
		);
		assert_eq!(next_download_percent(19, 1_000, &mut last_percent), None);
		assert_eq!(
			next_download_percent(20, 1_000, &mut last_percent),
			Some(2)
		);
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

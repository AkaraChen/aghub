use super::storage::{executable_file_name, prepare_staged_binary};
use super::CcusageRuntimeError;
use base64::Engine as _;
use flate2::read::GzDecoder;
use futures::StreamExt;
use semver::Version;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use sha2::{Digest, Sha512};
use std::fs;
use std::io::{self, Read};
use std::path::Path;
use std::time::Duration;

const REGISTRY_BASE_URL: &str = "https://registry.npmjs.org";
const REGISTRY_TIMEOUT: Duration = Duration::from_secs(120);
const METADATA_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_METADATA_BYTES: u64 = 1024 * 1024;
const MAX_TARBALL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_UNCOMPRESSED_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
pub(super) struct PlatformPackage {
	pub package_name: String,
	pub archive_member: String,
}

#[derive(Clone)]
pub(super) struct CcusageRegistry {
	client: reqwest::Client,
}

#[derive(Deserialize)]
struct VersionMetadata {
	version: String,
}

#[derive(Deserialize)]
struct PlatformMetadata {
	dist: PackageDist,
}

#[derive(Deserialize)]
struct PackageDist {
	tarball: String,
	integrity: String,
}

impl CcusageRegistry {
	pub(super) fn new() -> Result<Self, CcusageRuntimeError> {
		let client = reqwest::Client::builder()
			.timeout(REGISTRY_TIMEOUT)
			.build()?;
		Ok(Self { client })
	}

	pub(super) async fn latest_version(
		&self,
	) -> Result<Version, CcusageRuntimeError> {
		let response = self
			.client
			.get(format!("{REGISTRY_BASE_URL}/ccusage/latest"))
			.timeout(METADATA_TIMEOUT)
			.send()
			.await?
			.error_for_status()?;
		let metadata = metadata_json::<VersionMetadata>(response).await?;
		metadata.version.parse().map_err(|error| {
			CcusageRuntimeError::InvalidRegistryMetadata(format!(
				"invalid ccusage version '{}': {error}",
				metadata.version
			))
		})
	}

	pub(super) async fn download_platform_binary(
		&self,
		version: &Version,
		destination: &Path,
	) -> Result<(), CcusageRuntimeError> {
		let platform = platform_package()?;
		let encoded_name = platform.package_name.replace('/', "%2f");
		let response = self
			.client
			.get(format!("{REGISTRY_BASE_URL}/{encoded_name}/{version}"))
			.timeout(METADATA_TIMEOUT)
			.send()
			.await?
			.error_for_status()?;
		let metadata = metadata_json::<PlatformMetadata>(response).await?;
		let response = self
			.client
			.get(&metadata.dist.tarball)
			.send()
			.await?
			.error_for_status()?;
		if response
			.content_length()
			.is_some_and(|length| length > MAX_TARBALL_BYTES)
		{
			return Err(CcusageRuntimeError::ArchiveTooLarge);
		}
		let mut stream = response.bytes_stream();
		let mut bytes = Vec::new();
		while let Some(chunk) = stream.next().await {
			let chunk = chunk?;
			if bytes.len() as u64 + chunk.len() as u64 > MAX_TARBALL_BYTES {
				return Err(CcusageRuntimeError::ArchiveTooLarge);
			}
			bytes.extend_from_slice(&chunk);
		}
		verify_integrity(&bytes, &metadata.dist.integrity)?;
		extract_binary(&bytes, &platform.archive_member, destination)?;
		prepare_staged_binary(destination)
	}
}

async fn metadata_json<T: DeserializeOwned>(
	response: reqwest::Response,
) -> Result<T, CcusageRuntimeError> {
	if response
		.content_length()
		.is_some_and(|length| length > MAX_METADATA_BYTES)
	{
		return Err(metadata_too_large());
	}
	let mut stream = response.bytes_stream();
	let mut bytes = Vec::new();
	while let Some(chunk) = stream.next().await {
		let chunk = chunk?;
		append_metadata_chunk(&mut bytes, &chunk, MAX_METADATA_BYTES as usize)?;
	}
	serde_json::from_slice(&bytes).map_err(|error| {
		CcusageRuntimeError::InvalidRegistryMetadata(format!(
			"failed to parse registry response: {error}"
		))
	})
}

fn append_metadata_chunk(
	bytes: &mut Vec<u8>,
	chunk: &[u8],
	limit: usize,
) -> Result<(), CcusageRuntimeError> {
	if chunk.len() > limit.saturating_sub(bytes.len()) {
		return Err(metadata_too_large());
	}
	bytes.extend_from_slice(chunk);
	Ok(())
}

fn metadata_too_large() -> CcusageRuntimeError {
	CcusageRuntimeError::InvalidRegistryMetadata(
		"registry metadata response is too large".to_string(),
	)
}

pub(super) fn platform_package() -> Result<PlatformPackage, CcusageRuntimeError>
{
	let platform = match (std::env::consts::OS, std::env::consts::ARCH) {
		("macos", "aarch64") => "darwin-arm64",
		("macos", "x86_64") => "darwin-x64",
		("linux", "aarch64") => "linux-arm64",
		("linux", "x86_64") => "linux-x64",
		("windows", "aarch64") => "win32-arm64",
		("windows", "x86_64") => "win32-x64",
		(os, arch) => {
			return Err(CcusageRuntimeError::UnsupportedPlatform {
				os: os.to_string(),
				arch: arch.to_string(),
			});
		}
	};
	Ok(PlatformPackage {
		package_name: format!("@ccusage/ccusage-{platform}"),
		archive_member: format!("package/bin/{}", executable_file_name()),
	})
}

fn verify_integrity(
	tarball: &[u8],
	integrity: &str,
) -> Result<(), CcusageRuntimeError> {
	let expected = integrity
		.split_whitespace()
		.find_map(|value| value.strip_prefix("sha512-"))
		.ok_or_else(|| {
			CcusageRuntimeError::InvalidRegistryMetadata(
				"package integrity has no sha512 digest".to_string(),
			)
		})?;
	let expected = base64::engine::general_purpose::STANDARD
		.decode(expected)
		.map_err(|error| {
		CcusageRuntimeError::InvalidRegistryMetadata(format!(
			"invalid package integrity digest: {error}"
		))
	})?;
	let actual = Sha512::digest(tarball);
	if actual.as_slice() != expected.as_slice() {
		return Err(CcusageRuntimeError::IntegrityMismatch);
	}
	Ok(())
}

fn extract_binary(
	tarball: &[u8],
	member: &str,
	destination: &Path,
) -> Result<(), CcusageRuntimeError> {
	extract_binary_with_limits(
		tarball,
		member,
		destination,
		MAX_UNCOMPRESSED_ARCHIVE_BYTES,
		MAX_TARBALL_BYTES,
	)
}

fn extract_binary_with_limits(
	tarball: &[u8],
	member: &str,
	destination: &Path,
	archive_limit: u64,
	binary_limit: u64,
) -> Result<(), CcusageRuntimeError> {
	let decoder = GzDecoder::new(tarball);
	let mut decoded = Vec::new();
	decoder.take(archive_limit + 1).read_to_end(&mut decoded)?;
	if decoded.len() as u64 > archive_limit {
		return Err(CcusageRuntimeError::ArchiveTooLarge);
	}
	let mut archive = tar::Archive::new(decoded.as_slice());
	for entry in archive.entries()? {
		let mut entry = entry?;
		let path = entry.path()?;
		if path.to_string_lossy().replace('\\', "/") != member {
			continue;
		}
		if !entry.header().entry_type().is_file() {
			return Err(CcusageRuntimeError::InvalidArchiveMember(
				member.to_string(),
			));
		}
		if entry.size() > binary_limit {
			return Err(CcusageRuntimeError::ArchiveTooLarge);
		}
		if let Some(parent) = destination.parent() {
			fs::create_dir_all(parent)?;
		}
		let mut file = fs::File::create(destination)?;
		let copied = io::copy(
			&mut std::io::Read::take(&mut entry, binary_limit + 1),
			&mut file,
		)?;
		if copied > binary_limit {
			return Err(CcusageRuntimeError::ArchiveTooLarge);
		}
		file.sync_all()?;
		return Ok(());
	}
	Err(CcusageRuntimeError::MissingArchiveMember(
		member.to_string(),
	))
}

#[cfg(test)]
mod tests {
	use super::*;
	use flate2::write::GzEncoder;
	use flate2::Compression;

	fn tarball(
		path: &str,
		bytes: &[u8],
		entry_type: tar::EntryType,
	) -> Vec<u8> {
		let mut output = Vec::new();
		{
			let encoder = GzEncoder::new(&mut output, Compression::default());
			let mut archive = tar::Builder::new(encoder);
			let mut header = tar::Header::new_gnu();
			header.set_size(bytes.len() as u64);
			header.set_mode(0o755);
			header.set_entry_type(entry_type);
			header.set_cksum();
			archive.append_data(&mut header, path, bytes).unwrap();
			archive.into_inner().unwrap().finish().unwrap();
		}
		output
	}

	#[test]
	fn rejects_integrity_mismatch() {
		let error = verify_integrity(b"archive", "sha512-ZmFrZQ==")
			.expect_err("digest mismatch");
		assert!(matches!(error, CcusageRuntimeError::IntegrityMismatch));
	}

	#[test]
	fn limits_registry_metadata_bytes() {
		let mut bytes = vec![b'a'; 3];
		append_metadata_chunk(&mut bytes, b"b", 4).unwrap();
		let error = append_metadata_chunk(&mut bytes, b"c", 4)
			.expect_err("metadata exceeds limit");
		assert!(matches!(
			error,
			CcusageRuntimeError::InvalidRegistryMetadata(_)
		));
	}

	#[test]
	fn extracts_only_the_requested_regular_file() {
		let root = tempfile::tempdir().unwrap();
		let destination = root.path().join("ccusage");
		let bytes = tarball(
			"package/bin/ccusage",
			b"native-binary",
			tar::EntryType::Regular,
		);
		extract_binary(&bytes, "package/bin/ccusage", &destination).unwrap();
		assert_eq!(fs::read(destination).unwrap(), b"native-binary");
	}

	#[test]
	fn rejects_non_file_archive_member() {
		let root = tempfile::tempdir().unwrap();
		let bytes =
			tarball("package/bin/ccusage", b"target", tar::EntryType::Symlink);
		let error = extract_binary(
			&bytes,
			"package/bin/ccusage",
			&root.path().join("ccusage"),
		)
		.expect_err("symlink rejected");
		assert!(matches!(
			error,
			CcusageRuntimeError::InvalidArchiveMember(_)
		));
	}

	#[test]
	fn limits_total_archive_decompression() {
		let root = tempfile::tempdir().unwrap();
		let bytes =
			tarball("package/padding", &[0; 4096], tar::EntryType::Regular);
		let error = extract_binary_with_limits(
			&bytes,
			"package/bin/ccusage",
			&root.path().join("ccusage"),
			1024,
			1024,
		)
		.expect_err("archive exceeds decompression limit");
		assert!(matches!(error, CcusageRuntimeError::ArchiveTooLarge));
	}
}

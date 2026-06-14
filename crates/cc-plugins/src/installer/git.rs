//! Git-based download and extraction utilities

use anyhow::{Context, Result};
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

pub struct GitBasedInstaller {
	client: reqwest::Client,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SafeArchivePath {
	archive_path: String,
}

impl SafeArchivePath {
	fn new(parts: Vec<String>) -> Self {
		Self {
			archive_path: parts.join("/"),
		}
	}

	fn as_archive_path(&self) -> &str {
		&self.archive_path
	}

	fn to_target_path(&self) -> PathBuf {
		let mut target_path = PathBuf::new();
		for part in self.archive_path.split('/') {
			target_path.push(part);
		}
		target_path
	}
}

pub(crate) fn build_http_client(timeout_secs: u64) -> Result<reqwest::Client> {
	reqwest::Client::builder()
		.user_agent("aghub-plugin-installer")
		.timeout(std::time::Duration::from_secs(timeout_secs))
		.build()
		.context("Failed to create HTTP client")
}

fn safe_archive_relative_path(path: &Path) -> Result<SafeArchivePath> {
	if path.as_os_str().is_empty() || path.is_absolute() {
		anyhow::bail!("Unsafe archive path: {}", path.display());
	}

	let mut parts = Vec::new();
	for component in path.components() {
		match component {
			Component::Normal(part) => {
				let part = part.to_str().ok_or_else(|| {
					anyhow::anyhow!(
						"Archive path is not valid UTF-8: {}",
						path.display()
					)
				})?;
				if part.is_empty() {
					anyhow::bail!(
						"Unsafe empty archive path component: {}",
						path.display()
					);
				}
				parts.push(part.to_string());
			}
			Component::CurDir => {}
			Component::ParentDir
			| Component::RootDir
			| Component::Prefix(_) => {
				anyhow::bail!("Unsafe archive path: {}", path.display());
			}
		}
	}

	if parts.is_empty() {
		anyhow::bail!("Unsafe empty archive path: {}", path.display());
	}

	Ok(SafeArchivePath::new(parts))
}

fn ensure_safe_entry_type(
	entry_type: tar::EntryType,
	path: &str,
) -> Result<()> {
	if entry_type.is_file() || entry_type.is_dir() {
		return Ok(());
	}

	anyhow::bail!("Unsafe archive entry type {:?} for {}", entry_type, path)
}

fn ensure_canonical_child(child: &Path, root: &Path) -> Result<()> {
	if child == root || child.starts_with(root) {
		return Ok(());
	}

	anyhow::bail!(
		"Archive entry target escaped extraction root: {}",
		child.display()
	)
}

fn ensure_target_parent_safe(
	target_path: &Path,
	canonical_root: &Path,
) -> Result<()> {
	if let Ok(metadata) = std::fs::symlink_metadata(target_path) {
		if metadata.file_type().is_symlink() {
			anyhow::bail!(
				"Archive entry target is a symlink: {}",
				target_path.display()
			);
		}
	}

	let parent = target_path.parent().ok_or_else(|| {
		anyhow::anyhow!(
			"Archive entry target has no parent: {}",
			target_path.display()
		)
	})?;
	std::fs::create_dir_all(parent)?;
	let canonical_parent = parent.canonicalize().with_context(|| {
		format!("Failed to canonicalize parent {}", parent.display())
	})?;
	ensure_canonical_child(&canonical_parent, canonical_root)
}

fn reset_extraction_target(target_dir: &Path) -> Result<()> {
	match std::fs::symlink_metadata(target_dir) {
		Ok(metadata) => {
			if metadata.file_type().is_symlink() {
				anyhow::bail!(
					"Extraction target is a symlink: {}",
					target_dir.display()
				);
			}
			if !metadata.is_dir() {
				anyhow::bail!(
					"Extraction target is not a directory: {}",
					target_dir.display()
				);
			}
			std::fs::remove_dir_all(target_dir).with_context(|| {
				format!(
					"Failed to clear extraction target {}",
					target_dir.display()
				)
			})?;
		}
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
		Err(error) => {
			return Err(error).with_context(|| {
				format!(
					"Failed to inspect extraction target {}",
					target_dir.display()
				)
			});
		}
	}

	std::fs::create_dir_all(target_dir).with_context(|| {
		format!(
			"Failed to create extraction target {}",
			target_dir.display()
		)
	})
}

impl GitBasedInstaller {
	pub fn new() -> Result<Self> {
		Ok(Self {
			client: build_http_client(120)?,
		})
	}

	/// Download and extract tarball from URL
	/// Returns the commit SHA of what was downloaded
	pub async fn download_and_extract(
		&self,
		url: &str,
		subdir: &str,      // Subdirectory within the tarball to extract
		target_dir: &Path, // Where to extract to
	) -> Result<String> {
		// Download tarball
		let response = self
			.client
			.get(url)
			.send()
			.await
			.context("Failed to download tarball")?;

		if !response.status().is_success() {
			anyhow::bail!("Failed to download: HTTP {}", response.status());
		}

		let bytes = response
			.bytes()
			.await
			.context("Failed to read response body")?;
		let target_dir = target_dir.to_path_buf();
		let subdir = subdir.to_string();

		// Extract tarball in blocking task (tar::Archive is not Send)
		let url_for_error = url.to_string();
		let result = tokio::task::spawn_blocking(move || {
			Self::extract_tarball(&bytes, &subdir, &target_dir)
		})
		.await
		.context("Failed to spawn extraction task")?;

		let result = result.map_err(|e| {
			anyhow::anyhow!(
				"Failed to extract tarball from {}: {}",
				url_for_error,
				e
			)
		});

		result
	}

	/// Synchronous tarball extraction
	fn extract_tarball(
		bytes: &[u8],
		subdir: &str,
		target_dir: &Path,
	) -> Result<String> {
		// Check if tarball is too small (likely an error page)
		if bytes.len() < 100 {
			anyhow::bail!(
				"Downloaded content is too small ({} bytes), possibly an error response",
				bytes.len()
			);
		}

		// First pass: find common prefix
		let cursor = Cursor::new(bytes);
		let tar = flate2::read::GzDecoder::new(cursor);
		let mut archive = tar::Archive::new(tar);

		let mut entry_errors = Vec::new();
		let mut entries = Vec::new();
		for entry in archive.entries().context(
			"Failed to read tarball entries - archive may be corrupted or \
			 not a valid gzip file",
		)? {
			let entry = match entry {
				Ok(entry) => entry,
				Err(err) => {
					entry_errors.push(format!("{err:?}"));
					continue;
				}
			};
			let path = entry.path().context("Failed to read tar entry path")?;
			let path_str = path.to_string_lossy();
			if path_str.contains("pax_global_header") {
				continue;
			}
			let safe_path = safe_archive_relative_path(&path)?;
			entries.push(safe_path.as_archive_path().to_string());
		}

		if entries.is_empty() {
			let error_detail = if entry_errors.is_empty() {
				"No entries found in tarball".to_string()
			} else {
				format!("Entry errors: {}", entry_errors.join(", "))
			};
			anyhow::bail!(
				"Empty tarball ({} bytes, {} entry errors). {}",
				bytes.len(),
				entry_errors.len(),
				error_detail
			);
		}

		let prefix = Self::find_common_prefix_static(&entries);

		// Second pass: extract files
		let cursor = Cursor::new(bytes);
		let tar = flate2::read::GzDecoder::new(cursor);
		let mut archive = tar::Archive::new(tar);

		let subdir = subdir.trim_matches('/');
		let extract_prefix = if subdir.is_empty() {
			prefix.clone()
		} else {
			let safe_subdir = safe_archive_relative_path(Path::new(subdir))?;
			format!("{}{}/", prefix, safe_subdir.as_archive_path())
		};
		reset_extraction_target(target_dir)?;
		let canonical_target_dir =
			target_dir.canonicalize().with_context(|| {
				format!(
					"Failed to canonicalize extraction target {}",
					target_dir.display()
				)
			})?;

		for entry in archive.entries()? {
			let mut entry = entry?;
			let path = entry.path()?;
			let safe_path = safe_archive_relative_path(&path)?;
			let path_str = safe_path.as_archive_path();

			if path_str.starts_with(&extract_prefix) {
				let relative_path = path_str
					.strip_prefix(&extract_prefix)
					.ok_or_else(|| anyhow::anyhow!("Failed to strip prefix"))?;

				if relative_path.is_empty() {
					continue;
				}

				let relative_path =
					safe_archive_relative_path(Path::new(relative_path))?;
				let target_path =
					target_dir.join(relative_path.to_target_path());
				let entry_type = entry.header().entry_type();
				ensure_safe_entry_type(
					entry_type,
					safe_path.as_archive_path(),
				)?;

				if entry_type.is_dir() {
					std::fs::create_dir_all(&target_path)?;
					let canonical_dir =
						target_path.canonicalize().with_context(|| {
							format!(
								"Failed to canonicalize extracted directory {}",
								target_path.display()
							)
						})?;
					ensure_canonical_child(
						&canonical_dir,
						&canonical_target_dir,
					)?;
				} else {
					ensure_target_parent_safe(
						&target_path,
						&canonical_target_dir,
					)?;
					entry.unpack(&target_path)?;
				}
			}
		}

		let commit_sha = prefix
			.trim_end_matches('/')
			.rsplit('-')
			.next()
			.unwrap_or("unknown")
			.to_string();

		Ok(commit_sha)
	}

	/// Static version of find_common_prefix for use in spawn_blocking
	fn find_common_prefix_static(entries: &[String]) -> String {
		if entries.is_empty() {
			return String::new();
		}

		let first = &entries[0];
		let parts: Vec<_> = first.split('/').collect();

		for (i, _part) in parts.iter().enumerate() {
			let prefix = parts[..=i].join("/");
			let prefix_with_slash = format!("{}/", prefix);

			if !entries.iter().all(|e| e.starts_with(&prefix_with_slash)) {
				return parts[..i].join("/") + "/";
			}
		}

		parts.join("/") + "/"
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use flate2::write::GzEncoder;
	use flate2::Compression;
	use std::io::Write;
	use tar::Builder;
	use tempfile::tempdir;

	fn build_tarball<F>(write_entries: F) -> Vec<u8>
	where
		F: FnOnce(&mut Builder<&mut GzEncoder<Vec<u8>>>),
	{
		let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
		{
			let mut tar = Builder::new(&mut encoder);
			write_entries(&mut tar);
			tar.finish().unwrap();
		}
		encoder.finish().unwrap()
	}

	fn append_file<W: Write>(tar: &mut Builder<W>, path: &str, content: &[u8]) {
		let mut header = tar::Header::new_gnu();
		header.set_size(content.len() as u64);
		header.set_mode(0o644);
		header.set_cksum();
		tar.append_data(&mut header, path, content).unwrap();
	}

	fn append_raw_path_file<W: Write>(
		tar: &mut Builder<W>,
		path: &str,
		content: &[u8],
	) {
		assert!(path.len() < 100);
		let mut header = tar::Header::new_gnu();
		header.set_size(content.len() as u64);
		header.set_mode(0o644);
		header.as_mut_bytes()[..path.len()].copy_from_slice(path.as_bytes());
		header.set_cksum();
		tar.append(&header, content).unwrap();
	}

	fn append_link<W: Write>(
		tar: &mut Builder<W>,
		entry_type: tar::EntryType,
		path: &str,
		target: &str,
	) {
		let mut header = tar::Header::new_gnu();
		header.set_entry_type(entry_type);
		header.set_size(0);
		header.set_mode(0o777);
		header.set_link_name(target).unwrap();
		header.set_cksum();
		tar.append_data(&mut header, path, std::io::empty())
			.unwrap();
	}

	#[test]
	fn safe_archive_relative_path_accepts_normal_paths() {
		let path =
			safe_archive_relative_path(Path::new("./repo-root/file.txt"))
				.unwrap();
		assert_eq!(path.as_archive_path(), "repo-root/file.txt");
		assert_eq!(
			path.to_target_path(),
			PathBuf::from("repo-root").join("file.txt")
		);
	}

	#[test]
	fn safe_archive_relative_path_keeps_archive_separators() {
		let path = safe_archive_relative_path(Path::new(
			"repo-root/plugins/vercel/file.txt",
		))
		.unwrap();

		assert_eq!(path.as_archive_path(), "repo-root/plugins/vercel/file.txt");
	}

	#[test]
	fn safe_archive_relative_path_rejects_parent_escape() {
		assert!(safe_archive_relative_path(Path::new("../escape")).is_err());
		assert!(
			safe_archive_relative_path(Path::new("repo/../escape")).is_err()
		);
	}

	#[test]
	fn safe_archive_relative_path_rejects_absolute_paths() {
		assert!(safe_archive_relative_path(Path::new("/absolute")).is_err());
	}

	#[test]
	fn test_find_common_prefix() {
		let entries = vec![
			"anthropics-claude-plugins-abc123/plugins/vercel/plugin.json"
				.to_string(),
			"anthropics-claude-plugins-abc123/plugins/vercel/README.md"
				.to_string(),
			"anthropics-claude-plugins-abc123/plugins/vercel/skills/"
				.to_string(),
		];

		let prefix = GitBasedInstaller::find_common_prefix_static(&entries);
		assert_eq!(prefix, "anthropics-claude-plugins-abc123/plugins/vercel/");
	}

	#[test]
	fn test_extract_tarball_from_repo_root() {
		let temp_dir = tempdir().unwrap();
		let bytes = build_tarball(|tar| {
			let files = [
				(
					"repo-root-abc123/.claude-plugin/plugin.json",
					br#"{"name":"repo-root","description":"test","author":{"name":"A"}}"#
						.as_slice(),
				),
				("repo-root-abc123/README.md", b"# Test".as_slice()),
			];

			for (path, content) in files {
				append_file(tar, path, content);
			}
		});
		let commit =
			GitBasedInstaller::extract_tarball(&bytes, "", temp_dir.path())
				.unwrap();

		assert_eq!(commit, "abc123");
		assert!(temp_dir.path().join(".claude-plugin/plugin.json").exists());
		assert!(temp_dir.path().join("README.md").exists());
	}

	#[test]
	fn extract_tarball_rejects_parent_directory_escape() {
		let temp_dir = tempdir().unwrap();
		let target_dir = temp_dir.path().join("target");
		let bytes = build_tarball(|tar| {
			append_file(
				tar,
				"repo-root-abc123/.claude-plugin/plugin.json",
				br#"{"name":"repo-root"}"#,
			);
			append_raw_path_file(
				tar,
				"repo-root-abc123/../escape.txt",
				b"escape",
			);
		});

		let error = GitBasedInstaller::extract_tarball(&bytes, "", &target_dir)
			.unwrap_err();

		assert!(error.to_string().contains("Unsafe archive path"));
		assert!(!temp_dir.path().join("escape.txt").exists());
	}

	#[test]
	fn extract_tarball_rejects_absolute_paths() {
		let temp_dir = tempdir().unwrap();
		let bytes = build_tarball(|tar| {
			append_file(
				tar,
				"repo-root-abc123/.claude-plugin/plugin.json",
				br#"{"name":"repo-root"}"#,
			);
			append_raw_path_file(
				tar,
				"/repo-root-abc123/absolute.txt",
				b"absolute",
			);
		});

		let error =
			GitBasedInstaller::extract_tarball(&bytes, "", temp_dir.path())
				.unwrap_err();

		assert!(error.to_string().contains("Unsafe archive path"));
	}

	#[test]
	fn extract_tarball_rejects_symlink_entries() {
		let temp_dir = tempdir().unwrap();
		let bytes = build_tarball(|tar| {
			append_file(
				tar,
				"repo-root-abc123/.claude-plugin/plugin.json",
				br#"{"name":"repo-root"}"#,
			);
			append_link(
				tar,
				tar::EntryType::Symlink,
				"repo-root-abc123/link",
				"../../outside",
			);
		});

		let error =
			GitBasedInstaller::extract_tarball(&bytes, "", temp_dir.path())
				.unwrap_err();

		assert!(error.to_string().contains("Unsafe archive entry type"));
		assert!(!temp_dir.path().join("link").exists());
	}

	#[test]
	fn extract_tarball_rejects_hard_link_entries() {
		let temp_dir = tempdir().unwrap();
		let bytes = build_tarball(|tar| {
			append_file(
				tar,
				"repo-root-abc123/.claude-plugin/plugin.json",
				br#"{"name":"repo-root"}"#,
			);
			append_link(
				tar,
				tar::EntryType::Link,
				"repo-root-abc123/hard-link",
				"repo-root-abc123/.claude-plugin/plugin.json",
			);
		});

		let error =
			GitBasedInstaller::extract_tarball(&bytes, "", temp_dir.path())
				.unwrap_err();

		assert!(error.to_string().contains("Unsafe archive entry type"));
		assert!(!temp_dir.path().join("hard-link").exists());
	}

	#[test]
	fn extract_tarball_clears_partial_files_before_retry() {
		let temp_dir = tempdir().unwrap();
		let target_dir = temp_dir.path().join("target");
		let bad_bytes = build_tarball(|tar| {
			append_file(tar, "repo-root-bad123/old.txt", b"stale");
			append_link(
				tar,
				tar::EntryType::Symlink,
				"repo-root-bad123/link",
				"../../outside",
			);
		});

		let error =
			GitBasedInstaller::extract_tarball(&bad_bytes, "", &target_dir)
				.unwrap_err();

		assert!(error.to_string().contains("Unsafe archive entry type"));
		assert_eq!(
			std::fs::read_to_string(target_dir.join("old.txt")).unwrap(),
			"stale"
		);

		let good_bytes = build_tarball(|tar| {
			append_file(
				tar,
				"repo-root-good456/new.txt",
				b"fresh plugin content with enough unique text to pass the \
				 tarball size guard after gzip compression",
			);
		});
		let commit =
			GitBasedInstaller::extract_tarball(&good_bytes, "", &target_dir)
				.unwrap();

		assert_eq!(commit, "good456");
		assert!(!target_dir.join("old.txt").exists());
		assert_eq!(
			std::fs::read_to_string(target_dir.join("new.txt")).unwrap(),
			"fresh plugin content with enough unique text to pass the \
			 tarball size guard after gzip compression"
		);
	}

	#[test]
	fn extract_tarball_keeps_valid_subdir_extraction_working() {
		let temp_dir = tempdir().unwrap();
		let bytes = build_tarball(|tar| {
			append_file(
				tar,
				"repo-root-abc123/plugins/vercel/.claude-plugin/plugin.json",
				br#"{"name":"vercel"}"#,
			);
			append_file(
				tar,
				"repo-root-abc123/plugins/vercel/README.md",
				b"# Vercel",
			);
			append_file(tar, "repo-root-abc123/other.txt", b"other");
		});

		let commit = GitBasedInstaller::extract_tarball(
			&bytes,
			"plugins/vercel",
			temp_dir.path(),
		)
		.unwrap();

		assert_eq!(commit, "abc123");
		assert!(temp_dir.path().join(".claude-plugin/plugin.json").exists());
		assert!(temp_dir.path().join("README.md").exists());
		assert!(!temp_dir.path().join("other.txt").exists());
	}
}

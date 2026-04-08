//! Git-based download and extraction utilities

use anyhow::{Context, Result};
use std::io::Cursor;
use std::path::Path;

/// Git-based installer for downloading plugin tarballs
pub struct GitBasedInstaller {
	client: reqwest::Client,
}

impl GitBasedInstaller {
	pub fn new() -> Self {
		Self {
			client: reqwest::Client::builder()
				.user_agent("aghub-plugin-installer")
				.timeout(std::time::Duration::from_secs(120))
				.build()
				.expect("Failed to create HTTP client"),
		}
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
		let entries: Vec<_> = archive
			.entries()
			.context("Failed to read tarball entries - archive may be corrupted or not a valid gzip file")?
			.filter_map(|e| {
				match e {
					Ok(entry) => Some(entry),
					Err(err) => {
						entry_errors.push(format!("{:?}", err));
						None
					}
				}
			})
			.map(|e| e.path().map(|p| p.to_string_lossy().to_string()))
			.filter_map(|p| p.ok())
			.filter(|p| !p.contains("pax_global_header"))
			.collect();

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
			format!("{}{subdir}/", prefix)
		};

		for entry in archive.entries()? {
			let mut entry = entry?;
			let path = entry.path()?;
			let path_str = path.to_string_lossy();

			if path_str.starts_with(&extract_prefix) {
				let relative_path = path_str
					.strip_prefix(&extract_prefix)
					.ok_or_else(|| anyhow::anyhow!("Failed to strip prefix"))?;

				if relative_path.is_empty() {
					continue;
				}

				let target_path = target_dir.join(relative_path);

				if entry.header().entry_type().is_dir() {
					std::fs::create_dir_all(&target_path)?;
				} else {
					if let Some(parent) = target_path.parent() {
						std::fs::create_dir_all(parent)?;
					}
					entry.unpack(target_path)?;
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

	/// Get commit SHA for a URL (fetched from GitHub API)
	pub async fn get_commit_sha(&self, url: &str) -> Result<Option<String>> {
		// Extract owner/repo from tarball URL
		// URL format: https://github.com/{owner}/{repo}/tarball/refs/heads/{branch}
		let parts: Vec<_> = url.split('/').collect();
		if parts.len() >= 5 {
			let owner = parts[3];
			let repo = parts[4];

			// Try to get commit from API
			let api_url = format!(
				"https://api.github.com/repos/{}/{}/commits/HEAD",
				owner, repo
			);

			if let Ok(response) = self.client.get(&api_url).send().await {
				if let Ok(json) = response.json::<serde_json::Value>().await {
					return Ok(json
						.get("sha")
						.and_then(|s| s.as_str())
						.map(|s| s.to_string()));
				}
			}
		}

		Ok(None)
	}
}

impl Default for GitBasedInstaller {
	fn default() -> Self {
		Self::new()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

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
		use flate2::write::GzEncoder;
		use flate2::Compression;
		use tar::Builder;

		let temp_dir = std::env::temp_dir()
			.join(format!("aghub-git-installer-test-{}", std::process::id()));

		if temp_dir.exists() {
			std::fs::remove_dir_all(&temp_dir).unwrap();
		}

		std::fs::create_dir_all(&temp_dir).unwrap();

		let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
		{
			let mut tar = Builder::new(&mut encoder);
			let files = [
				(
					"repo-root-abc123/.claude-plugin/plugin.json",
					br#"{"name":"repo-root","description":"test","author":{"name":"A"}}"#
						.as_slice(),
				),
				("repo-root-abc123/README.md", b"# Test".as_slice()),
			];

			for (path, content) in files {
				let mut header = tar::Header::new_gnu();
				header.set_size(content.len() as u64);
				header.set_mode(0o644);
				header.set_cksum();
				tar.append_data(&mut header, path, content).unwrap();
			}
			tar.finish().unwrap();
		}

		let bytes = encoder.finish().unwrap();
		let commit =
			GitBasedInstaller::extract_tarball(&bytes, "", &temp_dir).unwrap();

		assert_eq!(commit, "abc123");
		assert!(temp_dir.join(".claude-plugin/plugin.json").exists());
		assert!(temp_dir.join("README.md").exists());

		std::fs::remove_dir_all(&temp_dir).unwrap();
	}
}

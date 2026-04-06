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
		let result = tokio::task::spawn_blocking(move || {
			Self::extract_tarball(&bytes, &subdir, &target_dir)
		})
		.await
		.context("Failed to spawn extraction task")?;

		result
	}

	/// Synchronous tarball extraction
	fn extract_tarball(
		bytes: &[u8],
		subdir: &str,
		target_dir: &Path,
	) -> Result<String> {
		// First pass: find common prefix
		let cursor = Cursor::new(bytes);
		let tar = flate2::read::GzDecoder::new(cursor);
		let mut archive = tar::Archive::new(tar);

		let entries: Vec<_> = archive
			.entries()
			.context("Failed to read tarball entries")?
			.filter_map(|e| e.ok())
			.map(|e| e.path().map(|p| p.to_string_lossy().to_string()))
			.filter_map(|p| p.ok())
			.collect();

		if entries.is_empty() {
			anyhow::bail!("Empty tarball");
		}

		let prefix = Self::find_common_prefix_static(&entries);

		// Second pass: extract files
		let cursor = Cursor::new(bytes);
		let tar = flate2::read::GzDecoder::new(cursor);
		let mut archive = tar::Archive::new(tar);

		let subdir_prefix =
			format!("{}{}/", prefix, subdir.trim_end_matches('/'));

		for entry in archive.entries()? {
			let mut entry = entry?;
			let path = entry.path()?;
			let path_str = path.to_string_lossy();

			if path_str.starts_with(&subdir_prefix) {
				let relative_path = path_str
					.strip_prefix(&subdir_prefix)
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
}

use gix::bstr::ByteSlice;
use std::path::{Component, Path};
use thiserror::Error;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteSourceType {
	Github,
	Gitlab,
	Git,
}

impl RemoteSourceType {
	pub fn as_str(&self) -> &'static str {
		match self {
			Self::Github => "github",
			Self::Gitlab => "gitlab",
			Self::Git => "git",
		}
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedRemoteSource {
	pub source: String,
	pub source_type: RemoteSourceType,
	pub source_url: String,
	pub clone_url: String,
}

impl ResolvedRemoteSource {
	pub fn identity(&self) -> String {
		canonical_remote_identity(&self.source_url)
			.unwrap_or_else(|| self.source_url.clone())
	}

	pub fn lock_source(&self) -> String {
		match self.source_type {
			RemoteSourceType::Github | RemoteSourceType::Gitlab => {
				self.source.clone()
			}
			RemoteSourceType::Git => self.identity(),
		}
	}
}

#[derive(Debug, Error)]
pub enum SourceError {
	#[error("Unsupported remote source '{0}'")]
	Unsupported(String),
	#[error("Invalid GitHub shorthand '{0}'")]
	InvalidGithubShorthand(String),
	#[error("Remote URL must not contain embedded credentials or query data")]
	EmbeddedCredentials,
}

fn validate_http_remote(parsed: &Url) -> Result<(), SourceError> {
	if !parsed.username().is_empty()
		|| parsed.password().is_some()
		|| parsed.query().is_some()
		|| parsed.fragment().is_some()
	{
		return Err(SourceError::EmbeddedCredentials);
	}
	Ok(())
}

fn canonical_remote_identity(source_url: &str) -> Option<String> {
	let parsed = Url::parse(source_url).ok()?;
	let host = parsed.host_str()?.to_ascii_lowercase();
	let port = parsed.port_or_known_default()?;
	let path = normalize_repo_path(Path::new(parsed.path()))?;
	Some(format!("{}://{host}:{port}/{path}", parsed.scheme()))
}

fn normalize_repo_path(path: &Path) -> Option<String> {
	let mut segments = path
		.components()
		.filter_map(|component| match component {
			Component::Normal(value) => value.to_str().map(str::to_string),
			_ => None,
		})
		.collect::<Vec<_>>();

	if segments.len() < 2 {
		return None;
	}

	if let Some(last) = segments.last_mut() {
		*last = last.strip_suffix(".git").unwrap_or(last).to_string();
		if last.is_empty() {
			return None;
		}
	}

	Some(segments.join("/"))
}

fn parse_github_repo_shorthand(
	source: &str,
) -> Result<(String, String), SourceError> {
	let trimmed = source.trim();
	let mut segments = if let Ok(parsed) = Url::parse(trimmed) {
		if parsed.scheme() != "github" {
			return Err(SourceError::InvalidGithubShorthand(
				source.to_string(),
			));
		}

		let path = if let Some(host) = parsed.host_str() {
			let suffix = parsed.path().trim_matches('/');
			if suffix.is_empty() {
				host.to_string()
			} else {
				format!("{host}/{suffix}")
			}
		} else {
			parsed.path().trim_matches('/').to_string()
		};

		Path::new(&path)
			.components()
			.filter_map(|component| match component {
				Component::Normal(value) => value.to_str().map(str::to_string),
				_ => None,
			})
			.collect::<Vec<_>>()
	} else {
		let path = Path::new(trimmed);
		if path.has_root() {
			return Err(SourceError::InvalidGithubShorthand(
				source.to_string(),
			));
		}
		path.components()
			.filter_map(|component| match component {
				Component::Normal(value) => value.to_str().map(str::to_string),
				_ => None,
			})
			.collect::<Vec<_>>()
	};

	if segments.len() != 2 {
		return Err(SourceError::InvalidGithubShorthand(source.to_string()));
	}

	if let Some(last) = segments.last_mut() {
		*last = last.strip_suffix(".git").unwrap_or(last).to_string();
		if last.is_empty() {
			return Err(SourceError::InvalidGithubShorthand(
				source.to_string(),
			));
		}
	}

	Ok((segments[0].clone(), segments[1].clone()))
}

fn build_github_clone_url(owner: &str, repo: &str) -> Url {
	let mut url = Url::parse("https://github.com/")
		.expect("static GitHub base URL is valid");
	{
		let mut segments = url
			.path_segments_mut()
			.expect("GitHub base URL supports path segments");
		segments.push(owner);
		segments.push(&format!("{repo}.git"));
	}
	url
}

fn source_type_from_host(host: Option<&str>) -> RemoteSourceType {
	match host {
		Some("github.com") => RemoteSourceType::Github,
		Some("gitlab.com") => RemoteSourceType::Gitlab,
		_ => RemoteSourceType::Git,
	}
}

pub fn normalize_repo_source_from_url(source_url: &str) -> Option<String> {
	let trimmed = source_url.trim();

	if let Ok(parsed) = Url::parse(trimmed) {
		let path = Path::new(parsed.path());
		return normalize_repo_path(path);
	}

	let parsed = gix::url::parse(trimmed.as_bytes().as_bstr()).ok()?;
	if matches!(parsed.scheme, gix::url::Scheme::File) {
		return None;
	}

	let repo_path = String::from_utf8_lossy(parsed.path.as_ref()).into_owned();
	normalize_repo_path(Path::new(&repo_path))
}

pub fn resolve_remote_source(
	source: &str,
) -> Result<ResolvedRemoteSource, SourceError> {
	let trimmed = source.trim();

	if let Ok(parsed) = Url::parse(trimmed) {
		match parsed.scheme() {
			"http" | "https" => {
				validate_http_remote(&parsed)?;
				let source = normalize_repo_source_from_url(parsed.as_str())
					.unwrap_or_else(|| parsed.to_string());
				return Ok(ResolvedRemoteSource {
					source,
					source_type: source_type_from_host(parsed.host_str()),
					source_url: parsed.to_string(),
					clone_url: parsed.to_string(),
				});
			}
			"github" => {
				let (owner, repo) = parse_github_repo_shorthand(trimmed)?;
				let clone_url = build_github_clone_url(&owner, &repo);
				return Ok(ResolvedRemoteSource {
					source: format!("{owner}/{repo}"),
					source_type: RemoteSourceType::Github,
					source_url: clone_url.to_string(),
					clone_url: clone_url.to_string(),
				});
			}
			_ => {}
		}
	}

	if let Ok(parsed) = gix::url::parse(trimmed.as_bytes().as_bstr()) {
		if !matches!(parsed.scheme, gix::url::Scheme::File) {
			let normalized = normalize_repo_source_from_url(trimmed)
				.unwrap_or_else(|| trimmed.into());
			let source_url =
				String::from_utf8_lossy(parsed.to_bstring().as_ref())
					.into_owned();

			return Ok(ResolvedRemoteSource {
				source: normalized,
				source_type: source_type_from_host(parsed.host()),
				source_url: source_url.clone(),
				clone_url: source_url,
			});
		}
	}

	let (owner, repo) = parse_github_repo_shorthand(trimmed)?;
	let clone_url = build_github_clone_url(&owner, &repo);
	Ok(ResolvedRemoteSource {
		source: format!("{owner}/{repo}"),
		source_type: RemoteSourceType::Github,
		source_url: clone_url.to_string(),
		clone_url: clone_url.to_string(),
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn normalizes_https_repo_sources() {
		let source = normalize_repo_source_from_url(
			"https://github.com/vercel-labs/agent-skills.git",
		);
		assert_eq!(source.as_deref(), Some("vercel-labs/agent-skills"));
	}

	#[test]
	fn normalizes_ssh_repo_sources() {
		let source = normalize_repo_source_from_url(
			"git@github.com:vercel-labs/agent-skills.git",
		);
		assert_eq!(source.as_deref(), Some("vercel-labs/agent-skills"));
	}

	#[test]
	fn resolves_github_shorthand() {
		let source = resolve_remote_source("vercel-labs/agent-skills").unwrap();
		assert_eq!(source.source, "vercel-labs/agent-skills");
		assert_eq!(source.source_type, RemoteSourceType::Github);
		assert_eq!(
			source.clone_url,
			"https://github.com/vercel-labs/agent-skills.git"
		);
	}

	#[test]
	fn resolves_github_scheme_shorthand() {
		let source =
			resolve_remote_source("github:vercel-labs/agent-skills").unwrap();
		assert_eq!(source.source, "vercel-labs/agent-skills");
		assert_eq!(source.source_type, RemoteSourceType::Github);
	}

	#[test]
	fn resolves_git_protocol_sources() {
		let source = resolve_remote_source(
			"git://github.com/vercel-labs/agent-skills.git",
		)
		.unwrap();
		assert_eq!(source.source, "vercel-labs/agent-skills");
		assert_eq!(source.source_type, RemoteSourceType::Github);
	}

	#[test]
	fn rejects_https_urls_with_embedded_credentials() {
		let result = resolve_remote_source(
			"https://user:token@example.com/owner/repo.git",
		);

		assert!(matches!(result, Err(SourceError::EmbeddedCredentials)));
	}

	#[test]
	fn rejects_https_urls_with_query_data() {
		let result =
			resolve_remote_source("https://example.com/owner/repo.git?token=x");

		assert!(matches!(result, Err(SourceError::EmbeddedCredentials)));
	}

	#[test]
	fn generic_remote_identity_includes_host_and_effective_port() {
		let first =
			resolve_remote_source("https://a.example/owner/repo.git").unwrap();
		let second =
			resolve_remote_source("https://b.example/owner/repo.git").unwrap();
		let explicit_port =
			resolve_remote_source("https://a.example:443/owner/repo.git")
				.unwrap();

		assert_ne!(first.identity(), second.identity());
		assert_eq!(first.identity(), explicit_port.identity());
		assert_eq!(first.lock_source(), first.identity());
	}

	#[test]
	fn remote_identity_removes_only_one_git_suffix() {
		let repository =
			resolve_remote_source("https://a.example/owner/repo.git").unwrap();
		let repository_named_git =
			resolve_remote_source("https://a.example/owner/repo.git.git")
				.unwrap();

		assert_ne!(repository.identity(), repository_named_git.identity());
	}

	#[test]
	fn github_shorthand_removes_only_one_git_suffix() {
		let repository = resolve_remote_source("owner/repo.git").unwrap();
		let repository_named_git =
			resolve_remote_source("owner/repo.git.git").unwrap();

		assert_eq!(repository.source, "owner/repo");
		assert_eq!(repository_named_git.source, "owner/repo.git");
		assert_ne!(repository.identity(), repository_named_git.identity());
	}
}

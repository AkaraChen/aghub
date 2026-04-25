use super::registry::normalize_repository_url;
use crate::PluginSource;
use std::path::PathBuf;

pub(super) enum RegistrySource {
	OfficialRegistry,
	GitHub { owner: String, repo: String },
	Local { path: PathBuf },
	UnsupportedRemote { url: String },
}

pub(super) fn classify_registry_source(source: &str) -> RegistrySource {
	let source = source.trim();
	if source.starts_with("git@github.com:") {
		return classify_remote_source(source);
	}

	match PluginSource::parse(source) {
		Ok(PluginSource::OfficialRegistry) => RegistrySource::OfficialRegistry,
		Ok(PluginSource::Local { path }) => RegistrySource::Local { path },
		Ok(PluginSource::ThirdParty { url }) => classify_remote_source(&url),
		Err(_) => RegistrySource::Local {
			path: PathBuf::from(source),
		},
	}
}

fn classify_remote_source(url: &str) -> RegistrySource {
	let normalized = normalize_repository_url(url);
	if let Some((owner, repo)) = aghub_git::resolve_remote_source(&normalized)
		.ok()
		.filter(|r| r.source_type == aghub_git::RemoteSourceType::Github)
		.and_then(|resolved| {
			resolved
				.source
				.split_once('/')
				.map(|(o, r)| (o.to_string(), r.to_string()))
		}) {
		return RegistrySource::GitHub { owner, repo };
	}
	RegistrySource::UnsupportedRemote { url: normalized }
}

#[cfg(test)]
mod tests {
	use super::{classify_registry_source, RegistrySource};

	#[test]
	fn test_classify_registry_source_supports_github_urls() {
		match classify_registry_source("https://github.com/foo/bar.git") {
			RegistrySource::GitHub { owner, repo } => {
				assert_eq!(owner, "foo");
				assert_eq!(repo, "bar");
			}
			_ => panic!("expected github source"),
		}
	}

	#[test]
	fn test_classify_registry_source_marks_non_github_urls_unsupported() {
		match classify_registry_source("https://gitlab.com/foo/bar") {
			RegistrySource::UnsupportedRemote { url } => {
				assert_eq!(url, "https://gitlab.com/foo/bar");
			}
			_ => panic!("expected unsupported remote source"),
		}
	}

	#[test]
	fn test_classify_registry_source_supports_git_ssh_urls() {
		match classify_registry_source("git@github.com:foo/bar.git") {
			RegistrySource::GitHub { owner, repo } => {
				assert_eq!(owner, "foo");
				assert_eq!(repo, "bar");
			}
			_ => panic!("expected github source"),
		}
	}

	#[test]
	fn test_classify_registry_source_keeps_relative_paths_local() {
		match classify_registry_source("plugins/demo") {
			RegistrySource::Local { path } => {
				assert_eq!(path, std::path::PathBuf::from("plugins/demo"));
			}
			_ => panic!("expected local source"),
		}
	}
}

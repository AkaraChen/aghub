use std::time::Duration;

use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{Manager, ResourceId, Url, Webview};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;

const GITHUB_RELEASES_API: &str =
	"https://api.github.com/repos/AkaraChen/aghub/releases?per_page=100";
const GITHUB_API_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_API_VERSION: &str = "2022-11-28";
const UPDATE_MANIFEST_ASSET: &str = "latest.json";
const UPDATER_USER_AGENT: &str = "aghub-updater";
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
	Stable,
	Beta,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
	tag_name: String,
	draft: bool,
	prerelease: bool,
	#[serde(default)]
	assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
	name: String,
	browser_download_url: String,
}

#[derive(Debug, thiserror::Error)]
enum UpdateSourceError {
	#[error("failed to resolve GitHub releases: {0}")]
	Github(#[source] reqwest::Error),
	#[error("no stable or beta release contains latest.json")]
	MissingManifest,
	#[error("invalid update manifest URL for {tag_name}: {reason}")]
	InvalidManifestUrl { tag_name: String, reason: String },
}

fn is_beta_version(version: &Version) -> bool {
	version.pre.as_str().split('.').any(|identifier| {
		let identifier = identifier.to_ascii_lowercase();
		if identifier == "beta" {
			return true;
		}

		identifier.strip_prefix("beta").is_some_and(|suffix| {
			!suffix.is_empty()
				&& suffix.chars().all(|character| character.is_ascii_digit())
		})
	})
}

fn release_version(release: &GithubRelease) -> Option<Version> {
	if release.draft
		|| !release
			.assets
			.iter()
			.any(|asset| asset.name == UPDATE_MANIFEST_ASSET)
	{
		return None;
	}

	let version =
		Version::parse(release.tag_name.trim_start_matches('v')).ok()?;
	let allowed = if release.prerelease {
		is_beta_version(&version)
	} else {
		version.pre.is_empty()
	};
	allowed.then_some(version)
}

fn select_update_release(releases: &[GithubRelease]) -> Option<&GithubRelease> {
	releases
		.iter()
		.filter_map(|release| {
			release_version(release).map(|version| (version, release))
		})
		.max_by(|(left, _), (right, _)| left.cmp(right))
		.map(|(_, release)| release)
}

fn update_manifest_url(
	release: &GithubRelease,
) -> Result<Url, UpdateSourceError> {
	let asset = release
		.assets
		.iter()
		.find(|asset| asset.name == UPDATE_MANIFEST_ASSET)
		.ok_or(UpdateSourceError::MissingManifest)?;
	Url::parse(&asset.browser_download_url).map_err(|error| {
		UpdateSourceError::InvalidManifestUrl {
			tag_name: release.tag_name.clone(),
			reason: error.to_string(),
		}
	})
}

async fn beta_update_endpoint() -> Result<Url, UpdateSourceError> {
	let client = reqwest::Client::builder()
		.timeout(UPDATE_CHECK_TIMEOUT)
		.user_agent(UPDATER_USER_AGENT)
		.build()
		.map_err(UpdateSourceError::Github)?;
	let releases = client
		.get(GITHUB_RELEASES_API)
		.header("Accept", GITHUB_API_ACCEPT)
		.header("X-GitHub-Api-Version", GITHUB_API_VERSION)
		.send()
		.await
		.map_err(UpdateSourceError::Github)?
		.error_for_status()
		.map_err(UpdateSourceError::Github)?
		.json::<Vec<GithubRelease>>()
		.await
		.map_err(UpdateSourceError::Github)?;
	let release = select_update_release(&releases)
		.ok_or(UpdateSourceError::MissingManifest)?;
	update_manifest_url(release)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
	rid: ResourceId,
	current_version: String,
	version: String,
	date: Option<String>,
	body: Option<String>,
	raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn check_for_update(
	webview: Webview,
	channel: UpdateChannel,
) -> Result<Option<UpdateMetadata>, String> {
	let mut updater = webview.updater_builder().timeout(UPDATE_CHECK_TIMEOUT);
	if matches!(channel, UpdateChannel::Beta) {
		let endpoint = beta_update_endpoint()
			.await
			.map_err(|error| error.to_string())?;
		updater = updater
			.endpoints(vec![endpoint])
			.map_err(|error| error.to_string())?;
	}
	let updater = updater.build().map_err(|error| error.to_string())?;
	let Some(update) =
		updater.check().await.map_err(|error| error.to_string())?
	else {
		return Ok(None);
	};

	let date = update
		.date
		.map(|date| date.format(&Rfc3339))
		.transpose()
		.map_err(|error| error.to_string())?;
	let metadata = UpdateMetadata {
		current_version: update.current_version.clone(),
		version: update.version.clone(),
		date,
		body: update.body.clone(),
		raw_json: update.raw_json.clone(),
		rid: webview.resources_table().add(update),
	};

	Ok(Some(metadata))
}

#[cfg(test)]
mod tests {
	use super::{select_update_release, GithubRelease, GithubReleaseAsset};

	fn release(tag_name: &str, prerelease: bool) -> GithubRelease {
		GithubRelease {
			tag_name: tag_name.to_string(),
			draft: false,
			prerelease,
			assets: vec![GithubReleaseAsset {
				name: "latest.json".to_string(),
				browser_download_url: format!(
					"https://example.com/{tag_name}/latest.json"
				),
			}],
		}
	}

	#[test]
	fn beta_channel_selects_the_highest_stable_or_beta_release() {
		let releases = [
			release("v1.9.0", false),
			release("v2.0.0-beta.1", true),
			release("v2.0.0-beta.2", true),
		];

		let selected = select_update_release(&releases).unwrap();

		assert_eq!(selected.tag_name, "v2.0.0-beta.2");
	}

	#[test]
	fn beta_channel_prefers_a_newer_stable_release() {
		let releases =
			[release("v2.0.0-beta.9", true), release("v2.0.0", false)];

		let selected = select_update_release(&releases).unwrap();

		assert_eq!(selected.tag_name, "v2.0.0");
	}

	#[test]
	fn beta_channel_ignores_other_prereleases_and_invalid_assets() {
		let mut draft = release("v3.0.0-beta.1", true);
		draft.draft = true;
		let mut missing_manifest = release("v2.2.0-beta.1", true);
		missing_manifest.assets.clear();
		let releases = [
			draft,
			missing_manifest,
			release("v2.1.0-rc.1", true),
			release("v2.0.0-alpha.1", true),
			release("not-a-version", false),
			release("v1.9.0", false),
		];

		let selected = select_update_release(&releases).unwrap();

		assert_eq!(selected.tag_name, "v1.9.0");
	}
}

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Manager, ResourceId, Url, Webview};
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;

const STABLE_UPDATE_ENDPOINT: &str =
	"https://github.com/AkaraChen/aghub/releases/latest/download/latest.json";
const BETA_UPDATE_ENDPOINT: &str =
	"https://raw.githubusercontent.com/AkaraChen/aghub/beta-channel/latest.json";
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
	Stable,
	Beta,
}

impl UpdateChannel {
	fn endpoint(self) -> &'static str {
		match self {
			Self::Stable => STABLE_UPDATE_ENDPOINT,
			Self::Beta => BETA_UPDATE_ENDPOINT,
		}
	}
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
	let endpoint = Url::parse(channel.endpoint()).map_err(|error| {
		format!("invalid {channel:?} update endpoint: {error}")
	})?;
	let updater = webview
		.updater_builder()
		.endpoints(vec![endpoint])
		.map_err(|error| error.to_string())?
		.timeout(UPDATE_CHECK_TIMEOUT)
		.build()
		.map_err(|error| error.to_string())?;
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
	use super::{UpdateChannel, BETA_UPDATE_ENDPOINT, STABLE_UPDATE_ENDPOINT};

	#[test]
	fn update_channels_select_their_manifest() {
		assert_eq!(UpdateChannel::Stable.endpoint(), STABLE_UPDATE_ENDPOINT);
		assert_eq!(UpdateChannel::Beta.endpoint(), BETA_UPDATE_ENDPOINT);
	}
}

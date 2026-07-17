//! Descriptor table for CLIProxyAPI scalar settings.
//!
//! Every management endpoint of the shape `GET/PUT /v0/management/<key>`
//! with a scalar payload is one row here; the client and the settings panel
//! are both driven by this table, so covering a new upstream setting is one
//! added row. Settings without a dedicated endpoint (routing strategy,
//! model aliases, cloak, …) go through the raw `config.yaml` editor instead.

use crate::dto::GatewaySettingKind;

pub struct GatewaySettingSpec {
	/// Endpoint path under `/v0/management/`, also the stable key exposed
	/// to the frontend.
	pub key: &'static str,
	pub kind: GatewaySettingKind,
	/// Grouping hint for the settings panel.
	pub group: &'static str,
}

pub const GATEWAY_SETTINGS: &[GatewaySettingSpec] = &[
	GatewaySettingSpec {
		key: "debug",
		kind: GatewaySettingKind::Bool,
		group: "logging",
	},
	GatewaySettingSpec {
		key: "logging-to-file",
		kind: GatewaySettingKind::Bool,
		group: "logging",
	},
	GatewaySettingSpec {
		key: "request-log",
		kind: GatewaySettingKind::Bool,
		group: "logging",
	},
	GatewaySettingSpec {
		key: "usage-statistics-enabled",
		kind: GatewaySettingKind::Bool,
		group: "usage",
	},
	GatewaySettingSpec {
		key: "ws-auth",
		kind: GatewaySettingKind::Bool,
		group: "security",
	},
	GatewaySettingSpec {
		key: "request-retry",
		kind: GatewaySettingKind::Integer,
		group: "network",
	},
	GatewaySettingSpec {
		key: "max-retry-interval",
		kind: GatewaySettingKind::Integer,
		group: "network",
	},
	GatewaySettingSpec {
		key: "proxy-url",
		kind: GatewaySettingKind::Text,
		group: "network",
	},
	GatewaySettingSpec {
		key: "quota-exceeded/switch-project",
		kind: GatewaySettingKind::Bool,
		group: "quota",
	},
	GatewaySettingSpec {
		key: "quota-exceeded/switch-preview-model",
		kind: GatewaySettingKind::Bool,
		group: "quota",
	},
];

/// The JSON field wrapping a scalar GET response is the last path segment
/// (`GET /quota-exceeded/switch-project` → `{"switch-project": …}`).
pub fn response_key(spec_key: &str) -> &str {
	spec_key.rsplit('/').next().unwrap_or(spec_key)
}

pub fn find(key: &str) -> Option<&'static GatewaySettingSpec> {
	GATEWAY_SETTINGS.iter().find(|spec| spec.key == key)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn response_key_takes_last_segment() {
		assert_eq!(response_key("debug"), "debug");
		assert_eq!(
			response_key("quota-exceeded/switch-project"),
			"switch-project"
		);
	}

	#[test]
	fn find_locates_known_keys() {
		assert!(find("proxy-url").is_some());
		assert!(find("nope").is_none());
	}
}

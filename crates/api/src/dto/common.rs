use aghub_core::models;
use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ConfigSource {
	Global,
	Project,
}

impl From<models::ConfigSource> for ConfigSource {
	fn from(value: models::ConfigSource) -> Self {
		match value {
			models::ConfigSource::Global => Self::Global,
			models::ConfigSource::Project => Self::Project,
		}
	}
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ResourceSourceKindDto {
	Native,
	Standard,
	Compatible,
	Plugin,
	Provider,
	System,
	Historical,
	External,
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ResourceWritePolicyDto {
	ReadWrite,
	ReadOnly,
	ManagedExternally,
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeVisibilityDto {
	Visible,
	Conditional,
	AuditOnly,
	Unknown,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ResourceOriginDto {
	pub product_id: String,
	pub surface_ids: Vec<String>,
	pub scope: ConfigSource,
	pub source_kind: ResourceSourceKindDto,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub physical_location: Option<String>,
	pub precedence: usize,
	pub write_policy: ResourceWritePolicyDto,
	pub runtime_visibility: RuntimeVisibilityDto,
	#[serde(skip_serializing_if = "Option::is_none")]
	#[ts(optional)]
	pub runtime_visibility_evidence: Option<String>,
}

impl From<&models::ResourceOrigin> for ResourceOriginDto {
	fn from(value: &models::ResourceOrigin) -> Self {
		Self {
			product_id: value.product_id.clone(),
			surface_ids: value.surface_ids.clone(),
			scope: value.scope.into(),
			source_kind: match value.source_kind {
				models::ResourceSourceKind::Native => {
					ResourceSourceKindDto::Native
				}
				models::ResourceSourceKind::Standard => {
					ResourceSourceKindDto::Standard
				}
				models::ResourceSourceKind::Compatible => {
					ResourceSourceKindDto::Compatible
				}
				models::ResourceSourceKind::Plugin => {
					ResourceSourceKindDto::Plugin
				}
				models::ResourceSourceKind::Provider => {
					ResourceSourceKindDto::Provider
				}
				models::ResourceSourceKind::System => {
					ResourceSourceKindDto::System
				}
				models::ResourceSourceKind::Historical => {
					ResourceSourceKindDto::Historical
				}
				models::ResourceSourceKind::External => {
					ResourceSourceKindDto::External
				}
			},
			physical_location: value.physical_location.clone(),
			precedence: value.precedence,
			write_policy: match value.write_policy {
				models::ResourceWritePolicy::ReadWrite => {
					ResourceWritePolicyDto::ReadWrite
				}
				models::ResourceWritePolicy::ReadOnly => {
					ResourceWritePolicyDto::ReadOnly
				}
				models::ResourceWritePolicy::ManagedExternally => {
					ResourceWritePolicyDto::ManagedExternally
				}
			},
			runtime_visibility: match value.runtime_visibility {
				models::RuntimeVisibility::Visible => {
					RuntimeVisibilityDto::Visible
				}
				models::RuntimeVisibility::Conditional => {
					RuntimeVisibilityDto::Conditional
				}
				models::RuntimeVisibility::AuditOnly => {
					RuntimeVisibilityDto::AuditOnly
				}
				models::RuntimeVisibility::Unknown => {
					RuntimeVisibilityDto::Unknown
				}
			},
			runtime_visibility_evidence: value
				.runtime_visibility_evidence
				.clone(),
		}
	}
}

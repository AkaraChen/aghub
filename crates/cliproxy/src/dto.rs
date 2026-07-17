//! ts-rs–exported gateway DTOs — the wire contract for
//! `/api/v1/gateway/*`, regenerated into the desktop app's `generated/dto`
//! via `crates/api/src/bin/export-dto.rs`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How aghub relates to a gateway instance: `Managed` means aghub downloaded
/// the binary and owns the process; `External` means the user points aghub at
/// an already-running CLIProxyAPI (often on a server) and aghub is only a
/// management-API client.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum GatewayInstanceKind {
	Managed,
	External,
}

/// Runtime status. External instances only ever report `Running` or
/// `Unhealthy`; the provisioning/process states apply to managed instances.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum GatewayInstanceStatus {
	/// Managed instance whose binary has not been downloaded yet.
	NotProvisioned,
	/// Managed instance with a binary but no running process.
	Stopped,
	/// Process spawned, management API not answering yet (grace period).
	Starting,
	/// Management API answers with our key.
	Running,
	/// Process exists (or external address configured) but the management
	/// API does not answer.
	Unhealthy,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct GatewayInstanceDto {
	pub id: String,
	pub name: String,
	pub kind: GatewayInstanceKind,
	/// e.g. `http://127.0.0.1:8317`
	pub base_url: String,
	/// Listen port (managed only).
	pub port: Option<u16>,
	/// Installed binary version (managed only).
	pub version: Option<String>,
	pub auto_start: bool,
	pub status: GatewayInstanceStatus,
	pub created_at: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateManagedGatewayRequest {
	pub name: Option<String>,
	/// Defaults to 8317. An existing `config.yaml` wins over this value.
	pub port: Option<u16>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateExternalGatewayRequest {
	pub name: String,
	pub base_url: String,
	pub management_key: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateGatewayInstanceRequest {
	pub name: Option<String>,
	pub auto_start: Option<bool>,
	/// External instances only.
	pub base_url: Option<String>,
	/// External instances only; rotates the stored key.
	pub management_key: Option<String>,
}

/// One credential file in the instance's auth-dir, as reported by
/// `GET /v0/management/auth-files`. Field set follows the documented shape;
/// everything the panel does not always send is optional with defaults so a
/// version drift degrades to blanks instead of a parse failure.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayAuthFileDto {
	#[serde(default)]
	pub id: Option<String>,
	/// Server-side credential handle, required by quota reset.
	#[serde(default)]
	pub auth_index: Option<String>,
	pub name: String,
	#[serde(default)]
	pub provider: Option<String>,
	#[serde(default)]
	pub label: Option<String>,
	#[serde(default)]
	pub status: Option<String>,
	#[serde(default)]
	pub status_message: Option<String>,
	#[serde(default)]
	pub disabled: bool,
	#[serde(default)]
	pub unavailable: bool,
	#[serde(default)]
	pub email: Option<String>,
	#[serde(default)]
	pub account: Option<String>,
	#[serde(default)]
	pub account_type: Option<String>,
	#[serde(default)]
	pub size: Option<u64>,
	#[serde(default)]
	pub modtime: Option<String>,
	#[serde(default)]
	pub success: Option<u64>,
	#[serde(default)]
	pub failed: Option<u64>,
}

/// Providers CLIProxyAPI can OAuth into via the management API (probed
/// against the pinned release; kimi and xai use a device-code flow).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum GatewayOauthProvider {
	Anthropic,
	Codex,
	Antigravity,
	Kimi,
	Xai,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct StartGatewayOauthRequest {
	pub provider: GatewayOauthProvider,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayAuthUrlDto {
	pub url: String,
	pub state: String,
	/// "device" for device-code providers (kimi/xai); absent for plain
	/// redirect flows.
	#[serde(default)]
	pub flow: Option<String>,
	/// Device-flow code the user confirms on the opened page.
	#[serde(default)]
	pub user_code: Option<String>,
	/// Device-flow validity window in seconds.
	#[serde(default)]
	pub expires_in: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum GatewayAuthPollStatus {
	Wait,
	Ok,
	Error,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayAuthPollDto {
	pub status: GatewayAuthPollStatus,
	#[serde(default)]
	pub error: Option<String>,
}

/// Push a locally obtained credential file to an instance ("account
/// roaming"): OAuth always completes on this machine, the resulting JSON is
/// uploaded to any instance, including remote ones that can never receive
/// the OAuth callback themselves.
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UploadGatewayAuthFileRequest {
	pub name: String,
	/// Raw credential JSON as produced by a local login.
	pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum GatewaySettingKind {
	Bool,
	Integer,
	Text,
}

/// A scalar setting value; the JSON representation is the bare scalar
/// (`true`, `3`, `"http://proxy"`), matching the management API's `value`
/// field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(untagged)]
pub enum GatewaySettingValue {
	Bool(bool),
	Integer(i64),
	Text(String),
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GatewaySettingDto {
	/// Stable key, also the management endpoint path (e.g.
	/// `quota-exceeded/switch-project`).
	pub key: String,
	pub kind: GatewaySettingKind,
	/// Grouping hint for the settings panel.
	pub group: String,
	/// `None` when this one setting could not be read; see `warnings`.
	pub value: Option<GatewaySettingValue>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GatewaySettingsDto {
	pub settings: Vec<GatewaySettingDto>,
	/// Per-setting read failures; a partially degraded panel still renders.
	pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateGatewaySettingRequest {
	pub value: GatewaySettingValue,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayApiKeysDto {
	pub keys: Vec<String>,
}

/// Which upstream key list a plain API key belongs to. Matches the
/// management endpoints `gemini-api-key` / `claude-api-key` /
/// `codex-api-key`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum GatewayUpstreamProvider {
	Gemini,
	Claude,
	Codex,
}

/// One upstream API key as the management API reports it (keys are
/// echoed back verbatim by these endpoints).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayUpstreamKeyDto {
	pub api_key: String,
	#[serde(default)]
	pub base_url: Option<String>,
	/// Server-side handle (quota reset target).
	#[serde(default)]
	pub auth_index: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GatewayUpstreamKeysDto {
	pub gemini: Vec<GatewayUpstreamKeyDto>,
	pub claude: Vec<GatewayUpstreamKeyDto>,
	pub codex: Vec<GatewayUpstreamKeyDto>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct AddGatewayUpstreamKeyRequest {
	pub provider: GatewayUpstreamProvider,
	pub api_key: String,
	pub base_url: Option<String>,
}

/// Model alias entry inside an OpenAI-compatibility provider.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayCompatModelDto {
	pub name: String,
	#[serde(default)]
	pub alias: Option<String>,
}

/// One `openai-compatibility` upstream (relay/aggregator). `api_keys`
/// is write-only: on write the server moves keys into its auth store
/// (associated via a stable `auth-index`), and no read path echoes
/// them — reads always return `api_keys` empty.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayCompatProviderDto {
	pub name: String,
	pub base_url: String,
	#[serde(default)]
	pub api_keys: Vec<String>,
	#[serde(default)]
	pub models: Vec<GatewayCompatModelDto>,
	#[serde(default)]
	pub disabled: bool,
	/// Server-side handle for the relay's key association.
	#[serde(default)]
	pub auth_index: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct AddGatewayCompatProviderRequest {
	pub name: String,
	pub base_url: String,
	pub api_key: String,
	/// Optional model names exposed by the relay; empty = passthrough.
	#[serde(default)]
	pub models: Vec<GatewayCompatModelDto>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct ResetGatewayQuotaRequest {
	pub auth_index: String,
}

#[derive(Debug, Serialize, Deserialize, Default, TS)]
#[ts(export)]
pub struct GatewayKeyUsageDto {
	#[serde(default)]
	pub success: u64,
	#[serde(default)]
	pub failed: u64,
}

/// `GET /v0/management/api-key-usage`: provider name → upstream identifier
/// (base URL or masked key) → counters.
#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GatewayUsageDto {
	pub providers: HashMap<String, HashMap<String, GatewayKeyUsageDto>>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct StartGatewayProvisionRequest {
	/// Optional release-host mirror (same GitHub `releases/download`
	/// layout); overrides the built-in host for this download only.
	pub mirror: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum GatewayProvisionPhase {
	Idle,
	Downloading,
	Extracting,
	Ready,
	Failed,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct GatewayProvisionStatusDto {
	pub version: String,
	pub phase: GatewayProvisionPhase,
	/// Download percentage when known (phase = downloading).
	pub progress: Option<u8>,
	/// Failure detail (phase = failed).
	pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum GatewayBinSource {
	/// `AGHUB_CLIPROXY_BIN` env override.
	Env,
	/// aghub-provisioned versioned install.
	Downloaded,
	/// Nothing usable yet.
	None,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct GatewayVersionDto {
	/// Version currently installed for managed use, if any.
	pub installed: Option<String>,
	/// The version this aghub build was validated against.
	pub pinned: String,
	/// Latest release reported by the instance, when reachable.
	pub latest: Option<String>,
	/// Where the effective binary comes from.
	pub bin_source: GatewayBinSource,
	/// A `cli-proxy-api` found on PATH (informational: package-manager
	/// installs are surfaced, never silently used — point
	/// `AGHUB_CLIPROXY_BIN` at it to opt in).
	pub system_bin: Option<String>,
}

/// `GET /v0/management/logs`: tail of the instance's file log.
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayLogsDto {
	pub latest_timestamp: Option<i64>,
	pub line_count: u64,
	pub lines: Vec<String>,
}

/// Per-provider model blocklist for OAuth accounts
/// (`oauth-excluded-models`): provider id → excluded model names
/// (wildcards allowed upstream).
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayOauthExcludedModelsDto {
	pub providers: HashMap<String, Vec<String>>,
}

/// Import a Google Vertex service-account JSON into the account pool.
#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct ImportGatewayVertexRequest {
	pub file_name: String,
	/// Raw service-account JSON.
	pub content: String,
}

/// Raw `config.yaml` passthrough for everything without a dedicated
/// endpoint (routing strategy, model aliases, cloak, …). The management API
/// hot-reloads on PUT.
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GatewayConfigFileDto {
	pub content: String,
}

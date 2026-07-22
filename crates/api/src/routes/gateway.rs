//! Gateway routes: CLIProxyAPI instances (managed local process or external
//! address), their account pool, keys, settings, and usage — all reached
//! through the instance's own management API. aghub keeps no shadow copy of
//! gateway configuration; `instances.json` + the keyring only record how to
//! reach each instance.
//!
//! Wiring into agents happens through the inference inventory: every
//! instance is mirrored as two provider entries (Anthropic wire and OpenAI
//! Responses wire — the codex adapter refuses anything but Responses, so
//! one entry cannot serve both), and existing per-agent bindings do the
//! rest. No gateway-level orchestration exists on purpose (ADR 0002).

use std::path::PathBuf;

use rocket::http::Status;
use rocket::serde::json::Json;
use rocket::State;

use aghub_cliproxy::{
	bootstrap, provision, settings, AddGatewayCompatProviderRequest,
	AddGatewayUpstreamKeyRequest, CreateExternalGatewayRequest,
	CreateManagedGatewayRequest, GatewayApiKeysDto, GatewayAuthFileDto,
	GatewayAuthPollDto, GatewayAuthUrlDto, GatewayCompatProviderDto,
	GatewayConfigFileDto, GatewayError, GatewayInstanceDto,
	GatewayInstanceKind, GatewayInstanceRecord, GatewayInstanceStatus,
	GatewayKeyUsageDto, GatewayLogsDto, GatewayOauthExcludedModelsDto,
	GatewayProvisionPhase, GatewayProvisionStatusDto, GatewaySettingDto,
	GatewaySettingsDto, GatewayUpstreamKeysDto, GatewayUpstreamProvider,
	GatewayUsageDto, GatewayVersionDto, ImportGatewayVertexRequest,
	InstanceStore, ManagementClient, ResetGatewayQuotaRequest,
	StartGatewayOauthRequest, StartGatewayProvisionRequest,
	UpdateGatewayInstanceRequest, UpdateGatewaySettingRequest,
	UploadGatewayAuthFileRequest,
};
use aghub_inference::{
	CreateInferenceProvider, InferenceProviderFormat,
	InferenceProviderRepository, InferenceProviderStore,
	UpdateInferenceProvider,
};

use crate::auth::ApiAuth;
use crate::error::{ApiCreated, ApiError, ApiNoContent, ApiResult};
use crate::extractors::TrustedLocalOrigin;
use crate::state::GatewayState;

/// Marks inference inventory entries mirrored from gateway instances.
const GATEWAY_PRESET: &str = "aghub-gateway";

/// Keyring account for the managed instance's management key. Fixed (not
/// per-instance): the key unlocks `~/.cli-proxy-api/config.yaml`, which
/// outlives any instance record — CLIProxyAPI bcrypt-hashes the key in the
/// file, so losing our plaintext copy would orphan the user's config after
/// a delete/re-create cycle.
const MANAGED_KEY_ID: &str = "managed-default";

fn key_id(record: &GatewayInstanceRecord) -> &str {
	match record.kind {
		GatewayInstanceKind::Managed => MANAGED_KEY_ID,
		GatewayInstanceKind::External => &record.id,
	}
}

fn store(state: &State<GatewayState>) -> InstanceStore {
	InstanceStore::new(&state.app_data_dir)
}

fn inference_store(state: &State<GatewayState>) -> InferenceProviderStore {
	InferenceProviderStore::new(state.app_data_dir.clone())
}

fn management_client(
	state: &State<GatewayState>,
	record: &GatewayInstanceRecord,
) -> Result<Option<ManagementClient>, ApiError> {
	let Some(key) = state.key_store.get_key(key_id(record))? else {
		return Ok(None);
	};
	Ok(Some(ManagementClient::new(&record.base_url, &key)?))
}

fn require_client(
	state: &State<GatewayState>,
	record: &GatewayInstanceRecord,
) -> Result<ManagementClient, ApiError> {
	management_client(state, record)?.ok_or_else(|| {
		ApiError::new(
			Status::UnprocessableEntity,
			format!(
				"no management key stored for gateway '{}'; start it once \
				 (managed) or re-add it with its key (external)",
				record.name
			),
			"GATEWAY_KEY_MISSING",
		)
	})
}

fn binary_installed(state: &State<GatewayState>) -> bool {
	provision::installed_bin(store(state).root(), provision::PINNED_VERSION)
		.is_some()
}

async fn instance_dto(
	state: &State<GatewayState>,
	record: &GatewayInstanceRecord,
) -> GatewayInstanceDto {
	let installed = binary_installed(state);
	let status = match management_client(state, record) {
		Ok(Some(client)) => {
			state.runtime.status(record, installed, &client).await
		}
		// No key yet: a managed instance simply has not been started, an
		// external one cannot be reached meaningfully.
		Ok(None) | Err(_) => match record.kind {
			GatewayInstanceKind::Managed if installed => {
				GatewayInstanceStatus::Stopped
			}
			GatewayInstanceKind::Managed => {
				GatewayInstanceStatus::NotProvisioned
			}
			GatewayInstanceKind::External => GatewayInstanceStatus::Unhealthy,
		},
	};
	GatewayInstanceDto {
		id: record.id.clone(),
		name: record.name.clone(),
		kind: record.kind,
		base_url: record.base_url.clone(),
		port: record.port,
		version: (record.kind == GatewayInstanceKind::Managed && installed)
			.then(|| provision::PINNED_VERSION.to_string()),
		auto_start: record.auto_start,
		status,
		created_at: record.created_at.clone(),
	}
}

/// First key in the instance's `api-keys` is the credential agents use to
/// call the gateway; create one when the list is empty.
async fn ensure_gateway_key(
	client: &ManagementClient,
) -> Result<String, GatewayError> {
	let keys = client.api_keys().await?;
	if let Some(first) = keys.first() {
		return Ok(first.clone());
	}
	let generated = format!("sk-aghub-{}", uuid::Uuid::new_v4().simple());
	client
		.set_api_keys(std::slice::from_ref(&generated))
		.await?;
	Ok(generated)
}

/// Inventory latin names must be pure lowercase a-z (see
/// `clean_latin_name` in the inference store), so the instance id's hex
/// prefix is mapped 0-f → a-p to form a stable, letters-only slug.
fn gateway_latin_names(record: &GatewayInstanceRecord) -> (String, String) {
	let slug: String = record
		.id
		.chars()
		.filter(char::is_ascii_hexdigit)
		.take(8)
		.map(|c| {
			let value = c.to_digit(16).unwrap_or(0) as u8;
			(b'a' + value) as char
		})
		.collect();
	(format!("gateway{slug}"), format!("gateway{slug}openai"))
}

/// Mirror an instance into the inference inventory as two provider entries
/// (per-wire-format, see module docs). Existing per-agent bindings then
/// handle the actual wiring; nothing here touches agent config files.
async fn sync_inference_providers(
	state: &State<GatewayState>,
	record: &GatewayInstanceRecord,
	client: &ManagementClient,
) -> Result<(), ApiError> {
	let gateway_key = ensure_gateway_key(client).await?;
	// Model list import (official panel parity): populate the mirrored
	// entries with what the gateway actually serves so bindings offer a
	// picker instead of a blank field. Both entries get the full list —
	// cross-protocol serving (e.g. Claude Code on a Gemini account) is the
	// point of the gateway. Best-effort: an empty list only means manual
	// model entry, so a failure is logged, not fatal.
	let models = match client.list_models(&gateway_key).await {
		Ok(models) => models,
		Err(error) => {
			log::warn!(
				"gateway '{}': model list import failed: {error}",
				record.name
			);
			Vec::new()
		}
	};
	let inventory = inference_store(state);
	let base = record.base_url.trim_end_matches('/').to_string();
	let (anthropic_name, openai_name) = gateway_latin_names(record);
	let entries = [
		(
			anthropic_name,
			record.name.clone(),
			InferenceProviderFormat::Anthropic,
			base.clone(),
		),
		(
			openai_name,
			format!("{} (OpenAI)", record.name),
			InferenceProviderFormat::OpenAiResponses,
			format!("{base}/v1"),
		),
	];
	for (latin_name, display_name, format, api_base_url) in entries {
		let existing = inventory
			.list()
			.map_err(ApiError::from)?
			.into_iter()
			.find(|provider| provider.latin_name == latin_name);
		match existing {
			Some(provider) => {
				inventory
					.update(
						&provider.id,
						UpdateInferenceProvider {
							display_name: Some(display_name),
							api_base_url: Some(api_base_url),
							api_key: Some(gateway_key.clone()),
							models: (!models.is_empty())
								.then(|| models.clone()),
							..Default::default()
						},
					)
					.map_err(ApiError::from)?;
			}
			None => {
				inventory
					.create(CreateInferenceProvider {
						latin_name,
						display_name,
						format,
						api_base_url,
						preset: Some(GATEWAY_PRESET.to_string()),
						api_key: gateway_key.clone(),
						models: models.clone(),
					})
					.map_err(ApiError::from)?;
			}
		}
	}
	Ok(())
}

fn remove_inference_providers(
	state: &State<GatewayState>,
	record: &GatewayInstanceRecord,
) -> Result<(), ApiError> {
	let inventory = inference_store(state);
	let (anthropic_name, openai_name) = gateway_latin_names(record);
	for provider in inventory.list().map_err(ApiError::from)? {
		let mirrored = provider.preset.as_deref() == Some(GATEWAY_PRESET)
			&& (provider.latin_name == anthropic_name
				|| provider.latin_name == openai_name);
		if mirrored {
			inventory.delete(&provider.id).map_err(ApiError::from)?;
		}
	}
	Ok(())
}

// ---- instances --------------------------------------------------------

#[get("/gateway/instances")]
pub async fn list_gateway_instances(
	_auth: ApiAuth,
	state: &State<GatewayState>,
) -> ApiResult<Vec<GatewayInstanceDto>> {
	let records = store(state).list().map_err(ApiError::from)?;
	let mut instances = Vec::with_capacity(records.len());
	for record in &records {
		instances.push(instance_dto(state, record).await);
	}
	Ok(Json(instances))
}

#[post("/gateway/instances/managed", data = "<request>")]
pub async fn create_managed_gateway(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	request: Json<CreateManagedGatewayRequest>,
) -> ApiCreated<GatewayInstanceDto> {
	let instances = store(state).list().map_err(ApiError::from)?;
	if instances
		.iter()
		.any(|record| record.kind == GatewayInstanceKind::Managed)
	{
		return Err(ApiError::new(
			Status::Conflict,
			"a managed gateway instance already exists",
			"RESOURCE_EXISTS",
		));
	}
	let port = request.port.unwrap_or(bootstrap::DEFAULT_PORT);
	let record = GatewayInstanceRecord {
		id: uuid::Uuid::new_v4().to_string(),
		name: request
			.name
			.clone()
			.filter(|name| !name.trim().is_empty())
			.unwrap_or_else(|| "Local Gateway".to_string()),
		kind: GatewayInstanceKind::Managed,
		base_url: format!("http://127.0.0.1:{port}"),
		port: Some(port),
		auto_start: false,
		created_at: chrono::Utc::now().to_rfc3339(),
	};
	store(state)
		.insert(record.clone())
		.map_err(ApiError::from)?;
	Ok((Status::Created, Json(instance_dto(state, &record).await)))
}

#[post("/gateway/instances/external", data = "<request>")]
pub async fn create_external_gateway(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	request: Json<CreateExternalGatewayRequest>,
) -> ApiCreated<GatewayInstanceDto> {
	let base_url = request.base_url.trim_end_matches('/').to_string();
	let client = ManagementClient::new(&base_url, &request.management_key)?;
	// Reject unreachable addresses / wrong keys before persisting anything.
	client.ping().await.map_err(ApiError::from)?;

	let record = GatewayInstanceRecord {
		id: uuid::Uuid::new_v4().to_string(),
		name: request.name.clone(),
		kind: GatewayInstanceKind::External,
		base_url,
		port: None,
		auto_start: false,
		created_at: chrono::Utc::now().to_rfc3339(),
	};
	store(state)
		.insert(record.clone())
		.map_err(ApiError::from)?;
	if let Err(error) = state
		.key_store
		.set_key(key_id(&record), &request.management_key)
	{
		if let Err(cleanup) = store(state).remove(&record.id) {
			log::error!(
				"gateway '{}': failed to roll back instance record: {cleanup}",
				record.name
			);
		}
		return Err(ApiError::from(error));
	}
	if let Err(error) = sync_inference_providers(state, &record, &client).await
	{
		if let Err(cleanup) = remove_inference_providers(state, &record) {
			log::error!(
				"gateway '{}': failed to roll back inference providers: {}",
				record.name,
				cleanup.body.error
			);
		}
		if let Err(cleanup) = store(state).remove(&record.id) {
			log::error!(
				"gateway '{}': failed to roll back instance record: {cleanup}",
				record.name
			);
		}
		if let Err(cleanup) = state.key_store.delete_key(key_id(&record)) {
			log::error!(
				"gateway '{}': failed to roll back management key: {cleanup}",
				record.name
			);
		}
		return Err(error);
	}
	Ok((Status::Created, Json(instance_dto(state, &record).await)))
}

#[put("/gateway/instances/<id>", data = "<request>")]
pub async fn update_gateway_instance(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<UpdateGatewayInstanceRequest>,
) -> ApiResult<GatewayInstanceDto> {
	let mut record = store(state).get(id).map_err(ApiError::from)?;
	if let Some(name) = &request.name {
		record.name = name.clone();
	}
	if let Some(auto_start) = request.auto_start {
		record.auto_start = auto_start;
	}
	if record.kind == GatewayInstanceKind::External {
		if let Some(base_url) = &request.base_url {
			record.base_url = base_url.trim_end_matches('/').to_string();
		}
		if let Some(key) = &request.management_key {
			state.key_store.set_key(key_id(&record), key)?;
		}
	} else if request.base_url.is_some() || request.management_key.is_some() {
		return Err(ApiError::new(
			Status::BadRequest,
			"base_url and management_key can only be changed on external \
			 instances",
			"INVALID_PARAM",
		));
	}
	store(state)
		.update(record.clone())
		.map_err(ApiError::from)?;
	// Keep the mirrored inventory entries in step when we can reach the
	// instance; a rename alone should not fail on an offline gateway.
	if let Ok(Some(client)) = management_client(state, &record) {
		if client.ping().await.is_ok() {
			sync_inference_providers(state, &record, &client).await?;
		}
	}
	Ok(Json(instance_dto(state, &record).await))
}

#[delete("/gateway/instances/<id>")]
pub async fn delete_gateway_instance(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	if record.kind == GatewayInstanceKind::Managed {
		// Best effort: adopted processes are not ours to kill and simply
		// keep running (the config stays the user's either way).
		let _ = state.runtime.stop(&record).await;
	}
	remove_inference_providers(state, &record)?;
	store(state).remove(id).map_err(ApiError::from)?;
	// The managed key stays: it unlocks the user-owned config.yaml, which
	// survives the instance record (re-creating the instance reuses both).
	if record.kind == GatewayInstanceKind::External {
		state.key_store.delete_key(&record.id)?;
	}
	Ok(rocket::response::status::NoContent)
}

// ---- managed lifecycle -------------------------------------------------

#[post("/gateway/instances/<id>/start")]
pub async fn start_gateway_instance(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewayInstanceDto> {
	let mut record = store(state).get(id).map_err(ApiError::from)?;
	if record.kind != GatewayInstanceKind::Managed {
		return Err(ApiError::new(
			Status::BadRequest,
			"external instances are started where they run",
			"INVALID_PARAM",
		));
	}
	let bin = provision::installed_bin(
		store(state).root(),
		provision::PINNED_VERSION,
	)
	.ok_or_else(|| {
		ApiError::from(GatewayError::NotProvisioned(
			provision::PINNED_VERSION.to_string(),
		))
	})?;

	let known_key = state.key_store.get_key(key_id(&record))?;
	let outcome = bootstrap::ensure_config(
		&bootstrap::default_config_dir(),
		record.port.unwrap_or(bootstrap::DEFAULT_PORT),
		known_key.as_deref(),
	)
	.map_err(ApiError::from)?;
	if known_key.as_deref() != Some(outcome.management_key.as_str()) {
		state
			.key_store
			.set_key(key_id(&record), &outcome.management_key)?;
	}
	// An existing config.yaml owns the port; follow it.
	if record.port != Some(outcome.port) {
		record.port = Some(outcome.port);
		record.base_url = format!("http://127.0.0.1:{}", outcome.port);
		store(state)
			.update(record.clone())
			.map_err(ApiError::from)?;
	}

	let client =
		ManagementClient::new(&record.base_url, &outcome.management_key)?;
	state
		.runtime
		.start(&record, &bin, &outcome.config_path, &client)
		.await
		.map_err(ApiError::from)?;
	sync_inference_providers(state, &record, &client).await?;
	Ok(Json(instance_dto(state, &record).await))
}

#[post("/gateway/instances/<id>/stop")]
pub async fn stop_gateway_instance(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewayInstanceDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	state.runtime.stop(&record).await.map_err(ApiError::from)?;
	Ok(Json(instance_dto(state, &record).await))
}

// ---- provisioning ------------------------------------------------------

#[post("/gateway/provision", data = "<request>")]
pub async fn start_gateway_provision(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	request: Json<StartGatewayProvisionRequest>,
) -> ApiResult<GatewayProvisionStatusDto> {
	{
		let current = state.provision.lock().expect("provision lock");
		if let Some(status) = current.as_ref() {
			if status.phase == GatewayProvisionPhase::Downloading
				|| status.phase == GatewayProvisionPhase::Extracting
			{
				return Ok(Json(status.clone()));
			}
		}
	}
	let root = store(state).root().to_path_buf();
	let slot = std::sync::Arc::clone(&state.provision);
	let version = provision::PINNED_VERSION.to_string();
	set_provision(
		&slot,
		&version,
		GatewayProvisionPhase::Downloading,
		Some(0),
		None,
	);
	let task_slot = std::sync::Arc::clone(&slot);
	let task_version = version.clone();
	let mirror = request.mirror.clone();
	tokio::spawn(async move {
		let progress_slot = std::sync::Arc::clone(&task_slot);
		let progress_version = task_version.clone();
		let result = provision::provision(
			&root,
			&task_version,
			mirror.as_deref(),
			move |phase, progress| {
				set_provision(
					&progress_slot,
					&progress_version,
					phase,
					progress,
					None,
				);
			},
		)
		.await;
		match result {
			Ok(_) => set_provision(
				&task_slot,
				&task_version,
				GatewayProvisionPhase::Ready,
				None,
				None,
			),
			Err(error) => set_provision(
				&task_slot,
				&task_version,
				GatewayProvisionPhase::Failed,
				None,
				Some(error.to_string()),
			),
		}
	});
	let status = state
		.provision
		.lock()
		.expect("provision lock")
		.clone()
		.expect("provision status just set");
	Ok(Json(status))
}

#[get("/gateway/provision/status")]
pub async fn gateway_provision_status(
	_auth: ApiAuth,
	state: &State<GatewayState>,
) -> ApiResult<GatewayProvisionStatusDto> {
	let status = state
		.provision
		.lock()
		.expect("provision lock")
		.clone()
		.unwrap_or(GatewayProvisionStatusDto {
			version: provision::PINNED_VERSION.to_string(),
			phase: if binary_installed(state) {
				GatewayProvisionPhase::Ready
			} else {
				GatewayProvisionPhase::Idle
			},
			progress: None,
			message: None,
		});
	Ok(Json(status))
}

fn set_provision(
	slot: &std::sync::Arc<std::sync::Mutex<Option<GatewayProvisionStatusDto>>>,
	version: &str,
	phase: GatewayProvisionPhase,
	progress: Option<u8>,
	message: Option<String>,
) {
	*slot.lock().expect("provision lock") = Some(GatewayProvisionStatusDto {
		version: version.to_string(),
		phase,
		progress,
		message,
	});
}

#[get("/gateway/instances/<id>/version")]
pub async fn gateway_version(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewayVersionDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let latest = match management_client(state, &record)? {
		Some(client) => client.latest_version().await.ok(),
		None => None,
	};
	let root = store(state).root().to_path_buf();
	Ok(Json(GatewayVersionDto {
		installed: binary_installed(state)
			.then(|| provision::PINNED_VERSION.to_string()),
		pinned: provision::PINNED_VERSION.to_string(),
		latest: latest.filter(|version| !version.is_empty()),
		bin_source: provision::bin_source(&root, provision::PINNED_VERSION),
		system_bin: provision::system_bin()
			.map(|path| path.display().to_string()),
	}))
}

// ---- account pool ------------------------------------------------------

#[get("/gateway/instances/<id>/auth-files")]
pub async fn list_gateway_auth_files(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<Vec<GatewayAuthFileDto>> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	Ok(Json(client.auth_files().await.map_err(ApiError::from)?))
}

#[post("/gateway/instances/<id>/auth-files", data = "<request>")]
pub async fn upload_gateway_auth_file(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<UploadGatewayAuthFileRequest>,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.upload_auth_file(&request.name, &request.content)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

/// Account roaming, download half: fetch a credential file (typically from
/// the local managed instance) so it can be pushed to another instance.
#[get("/gateway/instances/<id>/auth-files/content?<name>")]
pub async fn download_gateway_auth_file(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
	name: &str,
) -> ApiResult<UploadGatewayAuthFileRequest> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	let content = client
		.download_auth_file(name)
		.await
		.map_err(ApiError::from)?;
	Ok(Json(UploadGatewayAuthFileRequest {
		name: name.to_string(),
		content,
	}))
}

#[delete("/gateway/instances/<id>/auth-files?<name>")]
pub async fn delete_gateway_auth_file(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	name: &str,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.delete_auth_file(name)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

#[post("/gateway/instances/<id>/oauth", data = "<request>")]
pub async fn start_gateway_oauth(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<StartGatewayOauthRequest>,
) -> ApiResult<GatewayAuthUrlDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	Ok(Json(
		client
			.auth_url(request.provider)
			.await
			.map_err(ApiError::from)?,
	))
}

#[get("/gateway/instances/<id>/oauth/status?<oauth_state>")]
pub async fn gateway_oauth_status(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
	oauth_state: &str,
) -> ApiResult<GatewayAuthPollDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	Ok(Json(
		client
			.auth_status(oauth_state)
			.await
			.map_err(ApiError::from)?,
	))
}

// ---- gateway keys, settings, config, usage -----------------------------

#[get("/gateway/instances/<id>/api-keys")]
pub async fn get_gateway_api_keys(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewayApiKeysDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	Ok(Json(GatewayApiKeysDto {
		keys: client.api_keys().await.map_err(ApiError::from)?,
	}))
}

#[put("/gateway/instances/<id>/api-keys", data = "<request>")]
pub async fn put_gateway_api_keys(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<GatewayApiKeysDto>,
) -> ApiResult<GatewayApiKeysDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.set_api_keys(&request.keys)
		.await
		.map_err(ApiError::from)?;
	// Agents authenticate with the first key; keep the mirror in step.
	sync_inference_providers(state, &record, &client).await?;
	Ok(Json(GatewayApiKeysDto {
		keys: client.api_keys().await.map_err(ApiError::from)?,
	}))
}

#[get("/gateway/instances/<id>/settings")]
pub async fn get_gateway_settings(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewaySettingsDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	let mut settings_out = Vec::new();
	let mut warnings = Vec::new();
	for spec in settings::GATEWAY_SETTINGS {
		match client.setting(spec).await {
			Ok(value) => settings_out.push(GatewaySettingDto {
				key: spec.key.to_string(),
				kind: spec.kind,
				group: spec.group.to_string(),
				value: Some(value),
			}),
			Err(error) => {
				warnings.push(format!("{}: {error}", spec.key));
				settings_out.push(GatewaySettingDto {
					key: spec.key.to_string(),
					kind: spec.kind,
					group: spec.group.to_string(),
					value: None,
				});
			}
		}
	}
	Ok(Json(GatewaySettingsDto {
		settings: settings_out,
		warnings,
	}))
}

#[put("/gateway/instances/<id>/settings/<key..>", data = "<request>")]
pub async fn put_gateway_setting(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	key: PathBuf,
	request: Json<UpdateGatewaySettingRequest>,
) -> ApiNoContent {
	let key = key.to_string_lossy().replace('\\', "/");
	let spec = settings::find(&key).ok_or_else(|| {
		ApiError::new(
			Status::NotFound,
			format!("unknown gateway setting '{key}'"),
			"RESOURCE_NOT_FOUND",
		)
	})?;
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.set_setting(spec, &request.value)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

#[get("/gateway/instances/<id>/config-file")]
pub async fn get_gateway_config_file(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewayConfigFileDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	Ok(Json(GatewayConfigFileDto {
		content: client.config_yaml().await.map_err(ApiError::from)?,
	}))
}

#[put("/gateway/instances/<id>/config-file", data = "<request>")]
pub async fn put_gateway_config_file(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<GatewayConfigFileDto>,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.put_config_yaml(&request.content)
		.await
		.map_err(ApiError::from)?;
	sync_inference_providers(state, &record, &client).await?;
	Ok(rocket::response::status::NoContent)
}

// ---- upstream keys & relays ---------------------------------------------

#[get("/gateway/instances/<id>/upstream-keys")]
pub async fn list_gateway_upstream_keys(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewayUpstreamKeysDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	Ok(Json(GatewayUpstreamKeysDto {
		gemini: client
			.upstream_keys(GatewayUpstreamProvider::Gemini)
			.await
			.map_err(ApiError::from)?,
		claude: client
			.upstream_keys(GatewayUpstreamProvider::Claude)
			.await
			.map_err(ApiError::from)?,
		codex: client
			.upstream_keys(GatewayUpstreamProvider::Codex)
			.await
			.map_err(ApiError::from)?,
	}))
}

#[post("/gateway/instances/<id>/upstream-keys", data = "<request>")]
pub async fn add_gateway_upstream_key(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<AddGatewayUpstreamKeyRequest>,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.add_upstream_key(
			request.provider,
			&request.api_key,
			request.base_url.as_deref(),
		)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

#[delete("/gateway/instances/<id>/upstream-keys?<provider>&<api_key>")]
pub async fn delete_gateway_upstream_key(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	provider: &str,
	api_key: &str,
) -> ApiNoContent {
	let provider = match provider {
		"gemini" => GatewayUpstreamProvider::Gemini,
		"claude" => GatewayUpstreamProvider::Claude,
		"codex" => GatewayUpstreamProvider::Codex,
		other => {
			return Err(ApiError::new(
				Status::BadRequest,
				format!("unknown upstream provider '{other}'"),
				"INVALID_PARAM",
			))
		}
	};
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.delete_upstream_key(provider, api_key)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

#[get("/gateway/instances/<id>/compat-providers")]
pub async fn list_gateway_compat_providers(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<Vec<GatewayCompatProviderDto>> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	Ok(Json(
		client.compat_providers().await.map_err(ApiError::from)?,
	))
}

#[post("/gateway/instances/<id>/compat-providers", data = "<request>")]
pub async fn add_gateway_compat_provider(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<AddGatewayCompatProviderRequest>,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	let provider = GatewayCompatProviderDto {
		name: request.name.clone(),
		base_url: request.base_url.trim_end_matches('/').to_string(),
		api_keys: vec![request.api_key.clone()],
		models: request.models.clone(),
		disabled: false,
		auth_index: None,
	};
	client
		.add_compat_provider(&provider)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

#[delete("/gateway/instances/<id>/compat-providers?<name>")]
pub async fn delete_gateway_compat_provider(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	name: &str,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.delete_compat_provider(name)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

#[get("/gateway/instances/<id>/logs")]
pub async fn gateway_logs(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewayLogsDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	Ok(Json(client.logs().await.map_err(ApiError::from)?))
}

#[delete("/gateway/instances/<id>/logs")]
pub async fn clear_gateway_logs(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client.clear_logs().await.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

#[get("/gateway/instances/<id>/oauth-excluded-models")]
pub async fn get_gateway_oauth_excluded_models(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewayOauthExcludedModelsDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	Ok(Json(GatewayOauthExcludedModelsDto {
		providers: client
			.oauth_excluded_models()
			.await
			.map_err(ApiError::from)?,
	}))
}

#[put("/gateway/instances/<id>/oauth-excluded-models", data = "<request>")]
pub async fn put_gateway_oauth_excluded_models(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<GatewayOauthExcludedModelsDto>,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.set_oauth_excluded_models(&request.providers)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

/// Vertex service-account import ("account roaming" sibling: the JSON is
/// picked locally and pushed to any instance).
#[post("/gateway/instances/<id>/vertex-import", data = "<request>")]
pub async fn import_gateway_vertex(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<ImportGatewayVertexRequest>,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.import_vertex(&request.file_name, &request.content)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

#[post("/gateway/instances/<id>/accounts/reset-quota", data = "<request>")]
pub async fn reset_gateway_account_quota(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	id: &str,
	request: Json<ResetGatewayQuotaRequest>,
) -> ApiNoContent {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	client
		.reset_quota(&request.auth_index)
		.await
		.map_err(ApiError::from)?;
	Ok(rocket::response::status::NoContent)
}

#[get("/gateway/instances/<id>/usage")]
pub async fn gateway_usage(
	_auth: ApiAuth,
	state: &State<GatewayState>,
	id: &str,
) -> ApiResult<GatewayUsageDto> {
	let record = store(state).get(id).map_err(ApiError::from)?;
	let client = require_client(state, &record)?;
	let providers: std::collections::HashMap<
		String,
		std::collections::HashMap<String, GatewayKeyUsageDto>,
	> = client.api_key_usage().await.map_err(ApiError::from)?;
	Ok(Json(GatewayUsageDto { providers }))
}

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

use crate::auth::ApiAuth;
use crate::error::{ApiCreated, ApiError, ApiNoContent, ApiResult};
use crate::extractors::TrustedLocalOrigin;
use crate::gateway_projection;
use crate::state::GatewayState;

fn store(state: &State<GatewayState>) -> InstanceStore {
	InstanceStore::new(&state.app_data_dir)
}

fn management_client(
	state: &State<GatewayState>,
	record: &GatewayInstanceRecord,
) -> Result<Option<ManagementClient>, ApiError> {
	let Some(key) = state
		.key_store
		.get_key(gateway_projection::key_id(record))?
	else {
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

fn require_managed_instance(
	record: &GatewayInstanceRecord,
	operation: &str,
) -> Result<(), ApiError> {
	if record.kind == GatewayInstanceKind::Managed {
		return Ok(());
	}
	Err(ApiError::new(
		Status::UnprocessableEntity,
		format!("{operation} is only available for managed gateway instances"),
		"GATEWAY_MANAGED_ONLY",
	))
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

// ---- instances --------------------------------------------------------

#[get("/gateway/instances")]
pub async fn list_gateway_instances(
	_auth: ApiAuth,
	state: &State<GatewayState>,
) -> ApiResult<Vec<GatewayInstanceDto>> {
	let records = store(state).list().map_err(ApiError::from)?;
	let instances = futures::future::join_all(
		records.iter().map(|record| instance_dto(state, record)),
	)
	.await;
	Ok(Json(instances))
}

#[post("/gateway/instances/managed", data = "<request>")]
pub async fn create_managed_gateway(
	_auth: ApiAuth,
	_origin: TrustedLocalOrigin,
	state: &State<GatewayState>,
	request: Json<CreateManagedGatewayRequest>,
) -> ApiCreated<GatewayInstanceDto> {
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
		provider_projection: Default::default(),
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
		provider_projection: Default::default(),
	};
	store(state)
		.insert(record.clone())
		.map_err(ApiError::from)?;
	if let Err(error) = state
		.key_store
		.set_key(gateway_projection::key_id(&record), &request.management_key)
	{
		if let Err(cleanup) = store(state).remove(&record.id) {
			log::error!(
				"gateway '{}': failed to roll back instance record: {cleanup}",
				record.name
			);
		}
		return Err(ApiError::from(error));
	}
	if let Err(error) = gateway_projection::sync_gateway_providers(
		&state.app_data_dir,
		&record,
		&client,
	)
	.await
	{
		if let Err(cleanup) = gateway_projection::remove_gateway_instance(
			&state.app_data_dir,
			&record.id,
		)
		.await
		{
			log::error!(
				"gateway '{}': failed to roll back instance projection: {}",
				record.name,
				cleanup
			);
		}
		if let Err(cleanup) = state
			.key_store
			.delete_key(gateway_projection::key_id(&record))
		{
			log::error!(
				"gateway '{}': failed to roll back management key: {cleanup}",
				record.name
			);
		}
		return Err(ApiError::from(error));
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
	let original = record.clone();
	if request.auto_start.is_some() {
		require_managed_instance(&record, "auto-start")?;
	}
	if let Some(name) = &request.name {
		record.name = name.clone();
	}
	if let Some(auto_start) = request.auto_start {
		record.auto_start = auto_start;
	}
	let connection_changed = record.kind == GatewayInstanceKind::External
		&& (request.base_url.is_some() || request.management_key.is_some());
	let previous_key = if record.kind == GatewayInstanceKind::External {
		state
			.key_store
			.get_key(gateway_projection::key_id(&record))?
	} else {
		None
	};
	let mut verified_client = None;
	if record.kind == GatewayInstanceKind::External {
		if let Some(base_url) = &request.base_url {
			record.base_url = base_url.trim_end_matches('/').to_string();
		}
		if connection_changed {
			let key = request
				.management_key
				.as_deref()
				.or(previous_key.as_deref())
				.ok_or_else(|| {
					ApiError::new(
						Status::UnprocessableEntity,
						format!(
							"no management key stored for gateway '{}'",
							record.name
						),
						"GATEWAY_KEY_MISSING",
					)
				})?;
			let client = ManagementClient::new(&record.base_url, key)?;
			client.ping().await.map_err(ApiError::from)?;
			verified_client = Some(client);
		}
	} else if request.base_url.is_some() || request.management_key.is_some() {
		return Err(ApiError::new(
			Status::BadRequest,
			"base_url and management_key can only be changed on external \
			 instances",
			"INVALID_PARAM",
		));
	}
	let key_changed = request.management_key.is_some();
	if let Some(key) = &request.management_key {
		state
			.key_store
			.set_key(gateway_projection::key_id(&record), key)?;
	}
	if let Err(error) = store(state).update(record.clone()) {
		if key_changed {
			let restore = match previous_key.as_deref() {
				Some(key) => state
					.key_store
					.set_key(gateway_projection::key_id(&original), key),
				None => state
					.key_store
					.delete_key(gateway_projection::key_id(&original)),
			};
			if let Err(cleanup) = restore {
				log::error!(
					"gateway '{}': failed to restore management key: {cleanup}",
					original.name
				);
			}
		}
		return Err(ApiError::from(error));
	}

	if let Some(client) = verified_client {
		if let Err(error) = gateway_projection::sync_gateway_providers(
			&state.app_data_dir,
			&record,
			&client,
		)
		.await
		{
			if let Err(cleanup) = store(state).update(original.clone()) {
				log::error!(
					"gateway '{}': failed to restore instance record: {cleanup}",
					original.name
				);
			}
			if key_changed {
				let restore = match previous_key.as_deref() {
					Some(key) => state
						.key_store
						.set_key(gateway_projection::key_id(&original), key),
					None => state
						.key_store
						.delete_key(gateway_projection::key_id(&original)),
				};
				if let Err(cleanup) = restore {
					log::error!(
						"gateway '{}': failed to restore management key: {cleanup}",
						original.name
					);
				}
			}
			if let Some(key) = previous_key.as_deref() {
				if let Ok(client) =
					ManagementClient::new(&original.base_url, key)
				{
					if client.ping().await.is_ok() {
						if let Err(cleanup) =
							gateway_projection::sync_gateway_providers(
								&state.app_data_dir,
								&original,
								&client,
							)
							.await
						{
							log::error!(
								"gateway '{}': failed to restore provider projection: {}",
								original.name,
								cleanup
							);
						}
					}
				}
			}
			return Err(ApiError::from(error));
		}
	} else if let Ok(Some(client)) = management_client(state, &record) {
		// A rename should still succeed while an existing gateway is offline.
		if client.ping().await.is_ok() {
			gateway_projection::sync_gateway_providers(
				&state.app_data_dir,
				&record,
				&client,
			)
			.await
			.map_err(ApiError::from)?;
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
	gateway_projection::remove_gateway_instance(&state.app_data_dir, id)
		.await
		.map_err(ApiError::from)?;
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
	require_managed_instance(&record, "process start")?;
	let bin = provision::installed_bin(
		store(state).root(),
		provision::PINNED_VERSION,
	)
	.ok_or_else(|| {
		ApiError::from(GatewayError::NotProvisioned(
			provision::PINNED_VERSION.to_string(),
		))
	})?;

	let known_key = state
		.key_store
		.get_key(gateway_projection::key_id(&record))?;
	let config_dir = bootstrap::default_config_dir().map_err(ApiError::from)?;
	let outcome = bootstrap::ensure_config(
		&config_dir,
		record.port.unwrap_or(bootstrap::DEFAULT_PORT),
		known_key.as_deref(),
	)
	.map_err(ApiError::from)?;
	if known_key.as_deref() != Some(outcome.management_key.as_str()) {
		state.key_store.set_key(
			gateway_projection::key_id(&record),
			&outcome.management_key,
		)?;
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
	gateway_projection::sync_gateway_providers(
		&state.app_data_dir,
		&record,
		&client,
	)
	.await
	.map_err(ApiError::from)?;
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
	require_managed_instance(&record, "process stop")?;
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
	let version = provision::PINNED_VERSION.to_string();
	let (status, started) = begin_provision(&state.provision, &version);
	if !started {
		return Ok(Json(status));
	}
	let root = store(state).root().to_path_buf();
	let slot = std::sync::Arc::clone(&state.provision);
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

fn begin_provision(
	slot: &std::sync::Arc<std::sync::Mutex<Option<GatewayProvisionStatusDto>>>,
	version: &str,
) -> (GatewayProvisionStatusDto, bool) {
	let mut current = slot.lock().expect("provision lock");
	if let Some(status) = current.as_ref() {
		if status.phase == GatewayProvisionPhase::Downloading
			|| status.phase == GatewayProvisionPhase::Extracting
		{
			return (status.clone(), false);
		}
	}
	let status = GatewayProvisionStatusDto {
		version: version.to_string(),
		phase: GatewayProvisionPhase::Downloading,
		progress: Some(0),
		message: None,
	};
	*current = Some(status.clone());
	(status, true)
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
	require_managed_instance(&record, "binary version lookup")?;
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
	require_managed_instance(&record, "OAuth login")?;
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
	require_managed_instance(&record, "OAuth status lookup")?;
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
	gateway_projection::sync_gateway_providers(
		&state.app_data_dir,
		&record,
		&client,
	)
	.await
	.map_err(ApiError::from)?;
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
	gateway_projection::sync_gateway_providers(
		&state.app_data_dir,
		&record,
		&client,
	)
	.await
	.map_err(ApiError::from)?;
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn provision_begin_grants_one_concurrent_caller() {
		const CALLER_COUNT: usize = 16;

		let slot = std::sync::Arc::new(std::sync::Mutex::new(None));
		let barrier =
			std::sync::Arc::new(std::sync::Barrier::new(CALLER_COUNT));
		let mut callers = Vec::with_capacity(CALLER_COUNT);
		for _ in 0..CALLER_COUNT {
			let slot = std::sync::Arc::clone(&slot);
			let barrier = std::sync::Arc::clone(&barrier);
			callers.push(std::thread::spawn(move || {
				barrier.wait();
				begin_provision(&slot, provision::PINNED_VERSION).1
			}));
		}
		let started = callers
			.into_iter()
			.map(|caller| caller.join().expect("caller"))
			.filter(|started| *started)
			.count();

		assert_eq!(started, 1);
	}
}

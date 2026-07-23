use std::path::Path;
use std::sync::OnceLock;

use aghub_cliproxy::{
	GatewayError, GatewayInstanceKind, GatewayInstanceRecord, GatewayKeyStore,
	GatewayProviderProjection, InstanceStore, ManagementClient,
};
use aghub_inference::{
	CreateInferenceProvider, InferenceProvider, InferenceProviderError,
	InferenceProviderFormat, InferenceProviderRepository,
	InferenceProviderStore, UpdateInferenceProvider,
};
use tokio::sync::Mutex;

const GATEWAY_PRESET: &str = "aghub-gateway";
const MANAGED_KEY_ID: &str = "managed-default";

fn projection_mutation_lock() -> &'static Mutex<()> {
	static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
	LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum GatewayProjectionError {
	#[error(transparent)]
	Gateway(#[from] GatewayError),
	#[error(transparent)]
	Inference(#[from] InferenceProviderError),
}

pub(crate) struct GatewayProjectionFailure {
	pub instance_id: String,
	pub message: String,
}

#[derive(Default)]
pub(crate) struct GatewayProjectionReport {
	pub failures: Vec<GatewayProjectionFailure>,
}

#[derive(Clone, Copy)]
enum GatewayWire {
	Anthropic,
	OpenAi,
}

struct DesiredProvider {
	latin_name: String,
	legacy_latin_name: String,
	display_name: String,
	format: InferenceProviderFormat,
	api_base_url: String,
}

pub(crate) fn key_id(record: &GatewayInstanceRecord) -> &str {
	match record.kind {
		GatewayInstanceKind::Managed => MANAGED_KEY_ID,
		GatewayInstanceKind::External => &record.id,
	}
}

fn encoded_instance_id(id: &str) -> String {
	id.bytes()
		.flat_map(|byte| {
			[(b'a' + (byte >> 4)) as char, (b'a' + (byte & 0x0f)) as char]
		})
		.collect()
}

fn legacy_instance_slug(id: &str) -> String {
	id.chars()
		.filter(char::is_ascii_hexdigit)
		.take(8)
		.map(|character| {
			let value = character.to_digit(16).unwrap_or(0) as u8;
			(b'a' + value) as char
		})
		.collect()
}

fn gateway_latin_names(record: &GatewayInstanceRecord) -> (String, String) {
	let slug = encoded_instance_id(&record.id);
	(format!("gateway{slug}"), format!("gateway{slug}openai"))
}

fn legacy_gateway_latin_names(
	record: &GatewayInstanceRecord,
) -> (String, String) {
	let slug = legacy_instance_slug(&record.id);
	(format!("gateway{slug}"), format!("gateway{slug}openai"))
}

fn desired_provider(
	record: &GatewayInstanceRecord,
	wire: GatewayWire,
) -> DesiredProvider {
	let base = record.base_url.trim_end_matches('/');
	let (anthropic_name, openai_name) = gateway_latin_names(record);
	let (legacy_anthropic_name, legacy_openai_name) =
		legacy_gateway_latin_names(record);
	match wire {
		GatewayWire::Anthropic => DesiredProvider {
			latin_name: anthropic_name,
			legacy_latin_name: legacy_anthropic_name,
			display_name: record.name.clone(),
			format: InferenceProviderFormat::Anthropic,
			api_base_url: base.to_string(),
		},
		GatewayWire::OpenAi => DesiredProvider {
			latin_name: openai_name,
			legacy_latin_name: legacy_openai_name,
			display_name: format!("{} (OpenAI)", record.name),
			format: InferenceProviderFormat::OpenAiResponses,
			api_base_url: format!("{base}/v1"),
		},
	}
}

fn projected_id(
	projection: &GatewayProviderProjection,
	wire: GatewayWire,
) -> Option<&str> {
	match wire {
		GatewayWire::Anthropic => projection.anthropic_provider_id.as_deref(),
		GatewayWire::OpenAi => projection.openai_provider_id.as_deref(),
	}
}

fn set_projected_id(
	projection: &mut GatewayProviderProjection,
	wire: GatewayWire,
	id: String,
) {
	match wire {
		GatewayWire::Anthropic => {
			projection.anthropic_provider_id = Some(id);
		}
		GatewayWire::OpenAi => {
			projection.openai_provider_id = Some(id);
		}
	}
}

fn projection_contains_id(
	projection: &GatewayProviderProjection,
	provider_id: &str,
) -> bool {
	projection.anthropic_provider_id.as_deref() == Some(provider_id)
		|| projection.openai_provider_id.as_deref() == Some(provider_id)
}

fn provider_owner_id<'a>(
	provider: &InferenceProvider,
	records: &'a [GatewayInstanceRecord],
) -> Option<&'a str> {
	let projected_owner = records
		.iter()
		.filter(|record| {
			projection_contains_id(&record.provider_projection, &provider.id)
		})
		.min_by(|left, right| left.id.cmp(&right.id));
	if let Some(record) = projected_owner {
		return Some(&record.id);
	}
	if provider.preset.as_deref() != Some(GATEWAY_PRESET) {
		return None;
	}
	let full_name_owner = records
		.iter()
		.filter(|record| {
			let (anthropic, openai) = gateway_latin_names(record);
			provider.latin_name == anthropic || provider.latin_name == openai
		})
		.min_by(|left, right| left.id.cmp(&right.id));
	if let Some(record) = full_name_owner {
		return Some(&record.id);
	}
	records
		.iter()
		.filter(|record| {
			let (anthropic, openai) = legacy_gateway_latin_names(record);
			provider.latin_name == anthropic || provider.latin_name == openai
		})
		.min_by(|left, right| left.id.cmp(&right.id))
		.map(|record| record.id.as_str())
}

fn owned_provider<'a>(
	providers: &'a [InferenceProvider],
	records: &[GatewayInstanceRecord],
	record: &GatewayInstanceRecord,
	desired: &DesiredProvider,
	wire: GatewayWire,
) -> Option<&'a InferenceProvider> {
	providers.iter().find(|provider| {
		let matches_wire = projected_id(&record.provider_projection, wire)
			== Some(provider.id.as_str())
			|| (provider.preset.as_deref() == Some(GATEWAY_PRESET)
				&& (provider.latin_name == desired.latin_name
					|| provider.latin_name == desired.legacy_latin_name));
		matches_wire
			&& provider_owner_id(provider, records) == Some(record.id.as_str())
	})
}

fn upsert_provider(
	inventory: &InferenceProviderStore,
	providers: &[InferenceProvider],
	records: &[GatewayInstanceRecord],
	record: &GatewayInstanceRecord,
	wire: GatewayWire,
	gateway_key: &str,
	models: Option<&[String]>,
) -> Result<String, GatewayProjectionError> {
	let desired = desired_provider(record, wire);
	let provider = owned_provider(providers, records, record, &desired, wire);
	let provider = match provider {
		Some(provider) => inventory.update(
			&provider.id,
			UpdateInferenceProvider {
				latin_name: Some(desired.latin_name),
				display_name: Some(desired.display_name),
				format: Some(desired.format),
				api_base_url: Some(desired.api_base_url),
				preset: Some(Some(GATEWAY_PRESET.to_string())),
				api_key: Some(gateway_key.to_string()),
				models: models.map(<[String]>::to_vec),
			},
		)?,
		None => inventory.create(CreateInferenceProvider {
			latin_name: desired.latin_name,
			display_name: desired.display_name,
			format: desired.format,
			api_base_url: desired.api_base_url,
			preset: Some(GATEWAY_PRESET.to_string()),
			api_key: gateway_key.to_string(),
			models: models.unwrap_or_default().to_vec(),
		})?,
	};
	Ok(provider.id)
}

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

pub(crate) async fn sync_gateway_providers(
	app_data_dir: &Path,
	record: &GatewayInstanceRecord,
	client: &ManagementClient,
) -> Result<GatewayProviderProjection, GatewayProjectionError> {
	let _guard = projection_mutation_lock().lock().await;
	let gateway_key = ensure_gateway_key(client).await?;
	let models = match client.list_models(&gateway_key).await {
		Ok(models) => Some(models),
		Err(error) => {
			log::warn!(
				"gateway '{}': model list import failed: {error}",
				record.name
			);
			None
		}
	};
	let instance_store = InstanceStore::new(app_data_dir);
	let records = instance_store.list()?;
	let current = records
		.iter()
		.find(|candidate| candidate.id == record.id)
		.ok_or_else(|| GatewayError::InstanceNotFound(record.id.clone()))?;
	if current.base_url != record.base_url {
		return Ok(current.provider_projection.clone());
	}
	let inventory = InferenceProviderStore::new(app_data_dir.to_path_buf());
	let providers = inventory.list()?;
	let mut projection = current.provider_projection.clone();
	for wire in [GatewayWire::Anthropic, GatewayWire::OpenAi] {
		let provider_id = upsert_provider(
			&inventory,
			&providers,
			&records,
			current,
			wire,
			&gateway_key,
			models.as_deref(),
		)?;
		set_projected_id(&mut projection, wire, provider_id);
	}
	instance_store
		.update_provider_projection(&record.id, projection.clone())?;
	Ok(projection)
}

fn provider_belongs_to_record(
	provider: &InferenceProvider,
	record: &GatewayInstanceRecord,
	records: &[GatewayInstanceRecord],
) -> bool {
	provider_owner_id(provider, records) == Some(record.id.as_str())
}

pub(crate) async fn remove_gateway_instance(
	app_data_dir: &Path,
	id: &str,
) -> Result<GatewayInstanceRecord, GatewayProjectionError> {
	let _guard = projection_mutation_lock().lock().await;
	let instance_store = InstanceStore::new(app_data_dir);
	let records = instance_store.list()?;
	let record = records
		.iter()
		.find(|record| record.id == id)
		.ok_or_else(|| GatewayError::InstanceNotFound(id.to_string()))?;
	let inventory = InferenceProviderStore::new(app_data_dir.to_path_buf());
	for provider in inventory.list()? {
		if provider_belongs_to_record(&provider, record, &records) {
			inventory.delete(&provider.id)?;
		}
	}
	Ok(instance_store.remove(id)?)
}

async fn remove_orphaned_providers(
	app_data_dir: &Path,
) -> Result<(), GatewayProjectionError> {
	let _guard = projection_mutation_lock().lock().await;
	let records = InstanceStore::new(app_data_dir).list()?;
	let inventory = InferenceProviderStore::new(app_data_dir.to_path_buf());
	for provider in inventory.list()? {
		let orphaned = provider.preset.as_deref() == Some(GATEWAY_PRESET)
			&& provider_owner_id(&provider, &records).is_none();
		if orphaned {
			inventory.delete(&provider.id)?;
		}
	}
	Ok(())
}

pub(crate) async fn reconcile_gateway_providers(
	app_data_dir: &Path,
	key_store: &(dyn GatewayKeyStore + Send + Sync),
) -> GatewayProjectionReport {
	let instance_store = InstanceStore::new(app_data_dir);
	let mut report = GatewayProjectionReport::default();
	if let Err(error) = remove_orphaned_providers(app_data_dir).await {
		report.failures.push(GatewayProjectionFailure {
			instance_id: "inventory".to_string(),
			message: error.to_string(),
		});
	}
	let records = match instance_store.list() {
		Ok(records) => records,
		Err(error) => {
			report.failures.push(GatewayProjectionFailure {
				instance_id: "inventory".to_string(),
				message: error.to_string(),
			});
			return report;
		}
	};
	for record in records {
		let key = match key_store.get_key(key_id(&record)) {
			Ok(Some(key)) => key,
			Ok(None) => continue,
			Err(error) => {
				report.failures.push(GatewayProjectionFailure {
					instance_id: record.id.clone(),
					message: error.to_string(),
				});
				continue;
			}
		};
		let client = match ManagementClient::new(&record.base_url, &key) {
			Ok(client) => client,
			Err(error) => {
				report.failures.push(GatewayProjectionFailure {
					instance_id: record.id.clone(),
					message: error.to_string(),
				});
				continue;
			}
		};
		if client.ping().await.is_err() {
			continue;
		}
		if let Err(error) =
			sync_gateway_providers(app_data_dir, &record, &client).await
		{
			report.failures.push(GatewayProjectionFailure {
				instance_id: record.id,
				message: error.to_string(),
			});
		}
	}
	report
}

#[cfg(test)]
mod tests {
	use super::*;

	fn record(id: &str) -> GatewayInstanceRecord {
		GatewayInstanceRecord {
			id: id.to_string(),
			name: "Gateway".to_string(),
			kind: GatewayInstanceKind::External,
			base_url: "http://127.0.0.1:8317".to_string(),
			port: None,
			auto_start: false,
			created_at: "2026-07-23T00:00:00Z".to_string(),
			provider_projection: GatewayProviderProjection::default(),
		}
	}

	#[test]
	fn latin_names_use_the_complete_instance_id() {
		let first = record("12345678-0000-0000-0000-000000000001");
		let second = record("12345678-0000-0000-0000-000000000002");

		assert_ne!(gateway_latin_names(&first), gateway_latin_names(&second));
		assert_eq!(
			legacy_gateway_latin_names(&first),
			legacy_gateway_latin_names(&second)
		);
	}

	#[test]
	fn projection_ids_remain_authoritative_after_manual_rename() {
		let mut record = record("instance");
		record.provider_projection.anthropic_provider_id =
			Some("provider-id".to_string());
		let provider = InferenceProvider {
			id: "provider-id".to_string(),
			latin_name: "manuallyrenamed".to_string(),
			display_name: "Manual".to_string(),
			format: InferenceProviderFormat::Anthropic,
			api_base_url: "http://example.com".to_string(),
			preset: None,
			masked_api_key: "****".to_string(),
			models: Vec::new(),
		};

		assert!(provider_belongs_to_record(
			&provider,
			&record,
			std::slice::from_ref(&record),
		));
	}

	#[test]
	fn colliding_legacy_name_has_one_owner() {
		let first = record("12345678-0000-0000-0000-000000000001");
		let second = record("12345678-0000-0000-0000-000000000002");
		let provider = InferenceProvider {
			id: "legacy-provider".to_string(),
			latin_name: legacy_gateway_latin_names(&first).0,
			display_name: "Legacy".to_string(),
			format: InferenceProviderFormat::Anthropic,
			api_base_url: "http://example.com".to_string(),
			preset: Some(GATEWAY_PRESET.to_string()),
			masked_api_key: "****".to_string(),
			models: Vec::new(),
		};
		let records = vec![second.clone(), first.clone()];

		assert_eq!(
			provider_owner_id(&provider, &records),
			Some(first.id.as_str())
		);
		assert!(provider_belongs_to_record(&provider, &first, &records));
		assert!(!provider_belongs_to_record(&provider, &second, &records));
	}
}

//! SQLite-backed CRUD storage for inference providers.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{ConnectOptions, Connection, Row};

use crate::agent::{
	AgentProviderBinding, AgentProviderCredential, AgentProviderSource,
};
use crate::credentials::{CredentialStore, NativeCredentialStore};
use crate::error::{InferenceProviderError, Result};
use crate::model::{
	CreateInferenceProvider, InferenceProvider, InferenceProviderFormat,
	UpdateInferenceProvider,
};
use crate::provider_endpoint::{
	normalize_provider_api_base_url, provider_credential_scope_matches,
};

/// SQLite database file name under the app data directory.
pub const INFERENCE_PROVIDERS_FILE: &str = "inference_providers.db";

/// CRUD interface for inference provider metadata and API keys.
pub trait InferenceProviderRepository {
	/// List all providers.
	fn list(&self) -> Result<Vec<InferenceProvider>>;

	/// Get one provider by ID.
	fn get(&self, id: &str) -> Result<InferenceProvider>;

	/// Create a provider and store its API key in the native credential store.
	fn create(
		&self,
		input: CreateInferenceProvider,
	) -> Result<InferenceProvider>;

	/// Update provider metadata and optionally replace its API key.
	fn update(
		&self,
		id: &str,
		input: UpdateInferenceProvider,
	) -> Result<InferenceProvider>;

	/// Delete provider metadata and its API key.
	fn delete(&self, id: &str) -> Result<InferenceProvider>;

	/// Read the provider API key from the native credential store.
	fn get_api_key(&self, id: &str) -> Result<Option<String>>;

	/// Replace the provider API key in the native credential store.
	fn set_api_key(&self, id: &str, api_key: &str) -> Result<()>;

	/// Delete the provider API key from the native credential store.
	fn delete_api_key(&self, id: &str) -> Result<()>;
}

/// SQLite-backed inference provider store.
#[derive(Debug, Clone)]
pub struct InferenceProviderStore<C = NativeCredentialStore> {
	app_data_dir: PathBuf,
	credentials: C,
	credential_state: Arc<RwLock<()>>,
}

impl InferenceProviderStore<NativeCredentialStore> {
	/// Create a store rooted at a Tauri app data directory path.
	pub fn new(app_data_dir: impl Into<PathBuf>) -> Self {
		Self::with_credentials(app_data_dir, NativeCredentialStore)
	}

	/// Create a store from the current Tauri app handle.
	#[cfg(feature = "tauri")]
	pub fn from_tauri<R: tauri::Runtime>(
		app: &tauri::AppHandle<R>,
	) -> Result<Self> {
		use tauri::Manager;

		let app_data_dir = app.path().app_data_dir().map_err(|error| {
			InferenceProviderError::AppDataDir(error.to_string())
		})?;
		Ok(Self::new(app_data_dir))
	}
}

impl<C> InferenceProviderStore<C> {
	/// Create a store with an explicit credential store implementation.
	pub fn with_credentials(
		app_data_dir: impl Into<PathBuf>,
		credentials: C,
	) -> Self {
		Self {
			app_data_dir: app_data_dir.into(),
			credentials,
			credential_state: Arc::new(RwLock::new(())),
		}
	}

	/// App data directory used by this store.
	pub fn app_data_dir(&self) -> &Path {
		&self.app_data_dir
	}

	/// Full path to `inference_providers.db`.
	pub fn file_path(&self) -> PathBuf {
		self.app_data_dir.join(INFERENCE_PROVIDERS_FILE)
	}

	/// Bridge a future to synchronous callers.
	///
	/// Safe to call from `spawn_blocking` threads (Rocket handlers) or from
	/// plain synchronous code that has no active runtime. Must NOT be called
	/// from within an async task — use `block_in_place` for that.
	fn block_on<F>(&self, fut: F) -> F::Output
	where
		F: Future,
	{
		match tokio::runtime::Handle::try_current() {
			Ok(handle) => tokio::task::block_in_place(|| handle.block_on(fut)),
			Err(_) => tokio::runtime::Builder::new_current_thread()
				.enable_all()
				.build()
				.expect("failed to build tokio runtime")
				.block_on(fut),
		}
	}
}

impl<C: CredentialStore> InferenceProviderStore<C> {
	fn read_credential_state(&self) -> Result<RwLockReadGuard<'_, ()>> {
		self.credential_state
			.read()
			.map_err(|_| InferenceProviderError::CredentialStateUnavailable)
	}

	fn write_credential_state(&self) -> Result<RwLockWriteGuard<'_, ()>> {
		self.credential_state
			.write()
			.map_err(|_| InferenceProviderError::CredentialStateUnavailable)
	}

	/// Read provider metadata and its key as one credential snapshot.
	pub fn get_with_api_key(
		&self,
		id: &str,
	) -> Result<(InferenceProvider, Option<String>)> {
		let _credential_state = self.read_credential_state()?;
		let mut snapshot = self.provider_credential_snapshot(id)?;
		if credential_snapshot_is_legacy(&snapshot) {
			self.checkpoint_legacy_credentials()?;
			snapshot = self.provider_credential_snapshot(id)?;
		}
		let (provider, fingerprint) = snapshot;
		let api_key =
			self.verified_api_key(&provider, fingerprint.as_deref())?;
		Ok((provider, api_key))
	}

	/// List provider metadata and stored keys as one credential snapshot.
	pub fn list_with_api_keys(
		&self,
	) -> Result<Vec<(InferenceProvider, String)>> {
		let _credential_state = self.read_credential_state()?;
		let mut snapshots = self.provider_credential_snapshots()?;
		if snapshots.iter().any(credential_snapshot_is_legacy) {
			self.checkpoint_legacy_credentials()?;
			snapshots = self.provider_credential_snapshots()?;
		}
		let mut providers_with_keys = Vec::new();
		for (provider, fingerprint) in snapshots {
			let Some(api_key) =
				self.verified_api_key(&provider, fingerprint.as_deref())?
			else {
				continue;
			};
			providers_with_keys.push((provider, api_key));
		}
		Ok(providers_with_keys)
	}

	fn provider_credential_snapshot(
		&self,
		id: &str,
	) -> Result<(InferenceProvider, Option<String>)> {
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let mut transaction = conn.begin().await?;
			let snapshot =
				Self::fetch_by_id_with_credential(&mut transaction, id).await?;
			transaction.commit().await?;
			Ok(snapshot)
		})
	}

	fn provider_credential_snapshots(
		&self,
	) -> Result<Vec<(InferenceProvider, Option<String>)>> {
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let mut transaction = conn.begin().await?;
			let rows = sqlx::query(
				"SELECT id, latin_name, display_name, format, api_base_url, \
					 preset, masked_api_key, credential_fingerprint \
				 FROM inference_providers ORDER BY rowid",
			)
			.fetch_all(&mut *transaction)
			.await?;
			let mut snapshots = Vec::with_capacity(rows.len());
			for row in rows {
				let (mut provider, fingerprint) =
					map_provider_credential_row(row)?;
				provider.models =
					Self::fetch_model_names(&mut transaction, &provider.id)
						.await?;
				snapshots.push((provider, fingerprint));
			}
			transaction.commit().await?;
			Ok(snapshots)
		})
	}

	fn checkpoint_legacy_credentials(&self) -> Result<()> {
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let mut transaction = conn.begin_with("BEGIN IMMEDIATE").await?;
			let rows = sqlx::query(
				"SELECT id, masked_api_key, credential_fingerprint \
				 FROM inference_providers",
			)
			.fetch_all(&mut *transaction)
			.await?;
			for row in rows {
				let id: String = row.try_get("id")?;
				let masked_api_key: String = row.try_get("masked_api_key")?;
				let fingerprint: Option<String> =
					row.try_get("credential_fingerprint")?;
				if fingerprint.is_some() || masked_api_key.is_empty() {
					continue;
				}
				match self.credentials.get_api_key(&id)? {
					Some(api_key) => {
						sqlx::query(
							"UPDATE inference_providers \
							 SET credential_fingerprint = ? WHERE id = ?",
						)
						.bind(api_key_fingerprint(&api_key))
						.bind(&id)
						.execute(&mut *transaction)
						.await?;
					}
					None => {
						sqlx::query(
							"UPDATE inference_providers \
							 SET masked_api_key = '' WHERE id = ?",
						)
						.bind(&id)
						.execute(&mut *transaction)
						.await?;
					}
				}
			}
			transaction.commit().await?;
			Ok(())
		})
	}

	fn verified_api_key(
		&self,
		provider: &InferenceProvider,
		fingerprint: Option<&str>,
	) -> Result<Option<String>> {
		if provider.masked_api_key.is_empty() {
			return Ok(None);
		}
		let api_key = self.credentials.get_api_key(&provider.id)?;
		match (api_key.as_deref(), fingerprint) {
			(Some(api_key), Some(fingerprint))
				if api_key_fingerprint(api_key) != fingerprint =>
			{
				return Err(InferenceProviderError::CredentialStateUnavailable);
			}
			(None, Some(_)) => {
				return Err(InferenceProviderError::CredentialStateUnavailable);
			}
			_ => {}
		}
		Ok(api_key)
	}

	async fn open_db(&self) -> Result<SqliteConnection> {
		let db_path = self.file_path();
		if let Some(parent) = db_path.parent() {
			std::fs::create_dir_all(parent)?;
		}
		let mut conn = SqliteConnectOptions::new()
			.filename(&db_path)
			.create_if_missing(true)
			.connect()
			.await?;
		sqlx::query("PRAGMA foreign_keys = ON")
			.execute(&mut conn)
			.await?;
		sqlx::migrate!().run(&mut conn).await?;
		Ok(conn)
	}

	async fn fetch_by_id(
		conn: &mut SqliteConnection,
		id: &str,
	) -> Result<InferenceProvider> {
		let row = sqlx::query(
			"SELECT id, latin_name, display_name, format, api_base_url, \
                 preset, masked_api_key \
             FROM inference_providers WHERE id = ?",
		)
		.bind(id)
		.fetch_optional(&mut *conn)
		.await?;

		let mut provider = row
			.map(map_row)
			.transpose()?
			.ok_or_else(|| InferenceProviderError::NotFound(id.to_string()))?;
		provider.models = Self::fetch_model_names(conn, &provider.id).await?;
		Ok(provider)
	}

	async fn fetch_by_id_with_credential(
		conn: &mut SqliteConnection,
		id: &str,
	) -> Result<(InferenceProvider, Option<String>)> {
		let row = sqlx::query(
			"SELECT id, latin_name, display_name, format, api_base_url, \
				 preset, masked_api_key, credential_fingerprint \
			 FROM inference_providers WHERE id = ?",
		)
		.bind(id)
		.fetch_optional(&mut *conn)
		.await?
		.ok_or_else(|| InferenceProviderError::NotFound(id.to_string()))?;
		let (mut provider, fingerprint) = map_provider_credential_row(row)?;
		provider.models = Self::fetch_model_names(conn, &provider.id).await?;
		Ok((provider, fingerprint))
	}

	async fn check_latin_name_unique(
		conn: &mut SqliteConnection,
		latin_name: &str,
		ignore_id: Option<&str>,
	) -> Result<()> {
		let count: i64 = if let Some(id) = ignore_id {
			sqlx::query_scalar(
				"SELECT COUNT(*) FROM inference_providers \
                 WHERE latin_name = ? AND id != ?",
			)
			.bind(latin_name)
			.bind(id)
			.fetch_one(conn)
			.await?
		} else {
			sqlx::query_scalar(
				"SELECT COUNT(*) FROM inference_providers \
                 WHERE latin_name = ?",
			)
			.bind(latin_name)
			.fetch_one(conn)
			.await?
		};

		if count > 0 {
			Err(InferenceProviderError::AlreadyExists(
				latin_name.to_string(),
			))
		} else {
			Ok(())
		}
	}

	async fn fetch_model_names(
		conn: &mut SqliteConnection,
		provider_id: &str,
	) -> Result<Vec<String>> {
		let rows = sqlx::query(
			"SELECT name FROM inference_models \
             WHERE provider_id = ? ORDER BY rowid",
		)
		.bind(provider_id)
		.fetch_all(conn)
		.await?;

		rows.into_iter()
			.map(|row| row.try_get("name").map_err(Into::into))
			.collect()
	}

	async fn fetch_credential_fingerprint(
		conn: &mut SqliteConnection,
		provider_id: &str,
	) -> Result<Option<String>> {
		let row = sqlx::query(
			"SELECT credential_fingerprint \
			 FROM inference_providers WHERE id = ?",
		)
		.bind(provider_id)
		.fetch_optional(conn)
		.await?
		.ok_or_else(|| {
			InferenceProviderError::NotFound(provider_id.to_string())
		})?;
		row.try_get("credential_fingerprint").map_err(Into::into)
	}

	async fn checkpoint_legacy_credential(
		conn: &mut SqliteConnection,
		provider: &InferenceProvider,
		api_key: Option<&str>,
	) -> Result<()> {
		if Self::fetch_credential_fingerprint(conn, &provider.id)
			.await?
			.is_some()
			|| provider.masked_api_key.is_empty()
		{
			return Ok(());
		}
		if let Some(api_key) = api_key {
			sqlx::query(
				"UPDATE inference_providers \
				 SET credential_fingerprint = ? WHERE id = ?",
			)
			.bind(api_key_fingerprint(api_key))
			.bind(&provider.id)
			.execute(conn)
			.await?;
		} else {
			sqlx::query(
				"UPDATE inference_providers \
				 SET masked_api_key = '' WHERE id = ?",
			)
			.bind(&provider.id)
			.execute(conn)
			.await?;
		}
		Ok(())
	}

	async fn replace_models(
		conn: &mut SqliteConnection,
		provider_id: &str,
		models: &[String],
	) -> Result<()> {
		sqlx::query("DELETE FROM inference_models WHERE provider_id = ?")
			.bind(provider_id)
			.execute(&mut *conn)
			.await?;

		for model in models {
			sqlx::query(
				"INSERT INTO inference_models (provider_id, name) \
                 VALUES (?, ?)",
			)
			.bind(provider_id)
			.bind(model)
			.execute(&mut *conn)
			.await?;
		}

		Ok(())
	}
}

fn map_row(row: sqlx::sqlite::SqliteRow) -> Result<InferenceProvider> {
	let format_str: String = row.try_get("format")?;
	let format = format_str.parse::<InferenceProviderFormat>()?;
	Ok(InferenceProvider {
		id: row.try_get("id")?,
		latin_name: row.try_get("latin_name")?,
		display_name: row.try_get("display_name")?,
		format,
		api_base_url: row.try_get("api_base_url")?,
		preset: row.try_get("preset")?,
		masked_api_key: row.try_get("masked_api_key")?,
		models: Vec::new(),
	})
}

fn map_provider_credential_row(
	row: sqlx::sqlite::SqliteRow,
) -> Result<(InferenceProvider, Option<String>)> {
	let fingerprint = row.try_get("credential_fingerprint")?;
	Ok((map_row(row)?, fingerprint))
}

fn credential_snapshot_is_legacy(
	snapshot: &(InferenceProvider, Option<String>),
) -> bool {
	!snapshot.0.masked_api_key.is_empty() && snapshot.1.is_none()
}

impl<C: CredentialStore> InferenceProviderRepository
	for InferenceProviderStore<C>
{
	fn list(&self) -> Result<Vec<InferenceProvider>> {
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let rows = sqlx::query(
				"SELECT id, latin_name, display_name, format, api_base_url, \
                     preset, masked_api_key \
                 FROM inference_providers ORDER BY rowid",
			)
			.fetch_all(&mut conn)
			.await?;
			let mut providers = Vec::with_capacity(rows.len());
			for row in rows {
				let mut provider = map_row(row)?;
				provider.models =
					Self::fetch_model_names(&mut conn, &provider.id).await?;
				providers.push(provider);
			}
			Ok(providers)
		})
	}

	fn get(&self, id: &str) -> Result<InferenceProvider> {
		self.block_on(async {
			let mut conn = self.open_db().await?;
			Self::fetch_by_id(&mut conn, id).await
		})
	}

	fn create(
		&self,
		input: CreateInferenceProvider,
	) -> Result<InferenceProvider> {
		let _credential_state = self.write_credential_state()?;
		let latin_name = clean_latin_name(&input.latin_name)?;
		let display_name = clean_display_name(&input.display_name)?;
		let api_base_url = normalize_provider_api_base_url(&input.api_base_url)
			.map_err(InferenceProviderError::from)?;
		let preset = clean_optional_preset(input.preset.as_deref());
		let models = clean_model_names(&input.models)?;
		ensure_api_key(&input.api_key)?;

		self.block_on(async {
			let mut conn = self.open_db().await?;
			Self::check_latin_name_unique(&mut conn, &latin_name, None).await?;

			let provider = InferenceProvider {
				id: uuid::Uuid::new_v4().to_string(),
				latin_name,
				display_name,
				format: input.format,
				api_base_url,
				preset,
				masked_api_key: mask_api_key(&input.api_key),
				models,
			};

			self.credentials.set_api_key(&provider.id, &input.api_key)?;

			let result: Result<()> = async {
				let mut transaction = conn.begin().await?;
				sqlx::query(
					"INSERT INTO inference_providers \
                     (id, latin_name, display_name, format, api_base_url, \
                      preset, masked_api_key, credential_fingerprint) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				)
				.bind(&provider.id)
				.bind(&provider.latin_name)
				.bind(&provider.display_name)
				.bind(provider.format.to_string())
				.bind(&provider.api_base_url)
				.bind(&provider.preset)
				.bind(&provider.masked_api_key)
				.bind(api_key_fingerprint(&input.api_key))
				.execute(&mut *transaction)
				.await?;
				Self::replace_models(
					&mut transaction,
					&provider.id,
					&provider.models,
				)
				.await?;
				transaction.commit().await?;
				Ok(())
			}
			.await;

			if let Err(error) = result {
				let _ = self.credentials.delete_api_key(&provider.id);
				return Err(error);
			}

			Ok(provider)
		})
	}

	fn update(
		&self,
		id: &str,
		input: UpdateInferenceProvider,
	) -> Result<InferenceProvider> {
		let _credential_state = self.write_credential_state()?;
		let models = input
			.models
			.as_ref()
			.map(|models| clean_model_names(models))
			.transpose()?;
		let api_base_url = input
			.api_base_url
			.as_deref()
			.map(normalize_provider_api_base_url)
			.transpose()?;

		self.block_on(async {
			let mut conn = self.open_db().await?;
			let mut provider = Self::fetch_by_id(&mut conn, id).await?;
			let requested_format = input.format.unwrap_or(provider.format);
			let requested_api_base_url =
				api_base_url.as_deref().unwrap_or(&provider.api_base_url);
			if (input.format.is_some() || api_base_url.is_some())
				&& input.api_key.is_none()
				&& !provider_credential_scope_matches(
					&provider,
					requested_format,
					requested_api_base_url,
				) {
				return Err(
					InferenceProviderError::CredentialScopeChangeRequiresApiKey,
				);
			}

			if let Some(ref latin_name) = input.latin_name {
				let latin_name = clean_latin_name(latin_name)?;
				Self::check_latin_name_unique(&mut conn, &latin_name, Some(id))
					.await?;
				provider.latin_name = latin_name;
			}

			if let Some(ref display_name) = input.display_name {
				provider.display_name = clean_display_name(display_name)?;
			}

			if let Some(format) = input.format {
				provider.format = format;
			}

			if let Some(api_base_url) = api_base_url {
				provider.api_base_url = api_base_url;
			}

			if let Some(ref preset) = input.preset {
				provider.preset = clean_optional_preset(preset.as_deref());
			}

			if let Some(models) = models {
				provider.models = models;
			}

			let (previous_api_key, credential_fingerprint) =
				match input.api_key.as_ref() {
					Some(api_key) => {
						ensure_api_key(api_key)?;
						let previous = self.credentials.get_api_key(id)?;
						Self::checkpoint_legacy_credential(
							&mut conn,
							&provider,
							previous.as_deref(),
						)
						.await?;
						self.credentials.set_api_key(id, api_key)?;
						provider.masked_api_key = mask_api_key(api_key);
						(Some(previous), Some(api_key_fingerprint(api_key)))
					}
					None => (None, None),
				};

			let result: Result<()> = async {
				let mut transaction = conn.begin().await?;
				sqlx::query(
					"UPDATE inference_providers \
                     SET latin_name = ?, display_name = ?, format = ?, \
                         api_base_url = ?, preset = ?, masked_api_key = ?, \
                         credential_fingerprint = \
                             COALESCE(?, credential_fingerprint) \
                     WHERE id = ?",
				)
				.bind(&provider.latin_name)
				.bind(&provider.display_name)
				.bind(provider.format.to_string())
				.bind(&provider.api_base_url)
				.bind(&provider.preset)
				.bind(&provider.masked_api_key)
				.bind(credential_fingerprint.as_deref())
				.bind(id)
				.execute(&mut *transaction)
				.await?;
				if input.models.is_some() {
					Self::replace_models(
						&mut transaction,
						id,
						&provider.models,
					)
					.await?;
				}
				transaction.commit().await?;
				Ok(())
			}
			.await;

			if let Err(error) = result {
				if let Some(previous) = previous_api_key {
					let compensation = match previous {
						Some(key) => self.credentials.set_api_key(id, &key),
						None => self.credentials.delete_api_key(id),
					};
					if compensation.is_err() {
						return Err(
							InferenceProviderError::CredentialStateUnavailable,
						);
					}
				}
				return Err(error);
			}

			Ok(provider)
		})
	}

	fn delete(&self, id: &str) -> Result<InferenceProvider> {
		let _credential_state = self.write_credential_state()?;
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let provider = Self::fetch_by_id(&mut conn, id).await?;
			let previous_api_key = self.credentials.get_api_key(id)?;
			Self::checkpoint_legacy_credential(
				&mut conn,
				&provider,
				previous_api_key.as_deref(),
			)
			.await?;

			self.credentials.delete_api_key(id)?;

			let result =
				sqlx::query("DELETE FROM inference_providers WHERE id = ?")
					.bind(id)
					.execute(&mut conn)
					.await;

			if let Err(error) = result {
				if let Some(key) = previous_api_key {
					if self.credentials.set_api_key(id, &key).is_err() {
						return Err(
							InferenceProviderError::CredentialStateUnavailable,
						);
					}
				}
				return Err(error.into());
			}

			Ok(provider)
		})
	}

	fn get_api_key(&self, id: &str) -> Result<Option<String>> {
		self.get_with_api_key(id).map(|(_, api_key)| api_key)
	}

	fn set_api_key(&self, id: &str, api_key: &str) -> Result<()> {
		let _credential_state = self.write_credential_state()?;
		ensure_api_key(api_key)?;
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let provider = Self::fetch_by_id(&mut conn, id).await?;
			let previous = self.credentials.get_api_key(id)?;
			Self::checkpoint_legacy_credential(
				&mut conn,
				&provider,
				previous.as_deref(),
			)
			.await?;
			self.credentials.set_api_key(id, api_key)?;

			let result = sqlx::query(
				"UPDATE inference_providers \
				 SET masked_api_key = ?, credential_fingerprint = ? \
                 WHERE id = ?",
			)
			.bind(mask_api_key(api_key))
			.bind(api_key_fingerprint(api_key))
			.bind(id)
			.execute(&mut conn)
			.await;

			if let Err(error) = result {
				let compensation = match previous {
					Some(key) => self.credentials.set_api_key(id, &key),
					None => self.credentials.delete_api_key(id),
				};
				if compensation.is_err() {
					return Err(
						InferenceProviderError::CredentialStateUnavailable,
					);
				}
				return Err(error.into());
			}

			Ok(())
		})
	}

	fn delete_api_key(&self, id: &str) -> Result<()> {
		let _credential_state = self.write_credential_state()?;
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let provider = Self::fetch_by_id(&mut conn, id).await?;
			let previous = self.credentials.get_api_key(id)?;
			Self::checkpoint_legacy_credential(
				&mut conn,
				&provider,
				previous.as_deref(),
			)
			.await?;
			self.credentials.delete_api_key(id)?;

			let result = sqlx::query(
				"UPDATE inference_providers \
				 SET masked_api_key = '', credential_fingerprint = NULL \
                 WHERE id = ?",
			)
			.bind(id)
			.execute(&mut conn)
			.await;

			if let Err(error) = result {
				if let Some(key) = previous {
					if self.credentials.set_api_key(id, &key).is_err() {
						return Err(
							InferenceProviderError::CredentialStateUnavailable,
						);
					}
				}
				return Err(error.into());
			}

			Ok(())
		})
	}
}

fn clean_model_name(name: &str) -> Result<String> {
	let name = name.trim();
	if name.is_empty() {
		Err(InferenceProviderError::EmptyModelName)
	} else {
		Ok(name.to_string())
	}
}

fn clean_model_names(models: &[String]) -> Result<Vec<String>> {
	let mut seen = HashSet::new();
	let mut clean = Vec::with_capacity(models.len());

	for model in models {
		let model = clean_model_name(model)?;
		if !seen.insert(model.to_ascii_lowercase()) {
			return Err(InferenceProviderError::ModelAlreadyExists(model));
		}
		clean.push(model);
	}

	Ok(clean)
}

fn clean_optional_preset(preset: Option<&str>) -> Option<String> {
	preset.and_then(|value| {
		let value = value.trim();
		if value.is_empty() {
			None
		} else {
			Some(value.to_string())
		}
	})
}

fn clean_latin_name(latin_name: &str) -> Result<String> {
	let latin_name = latin_name.trim();
	if latin_name.is_empty() {
		Err(InferenceProviderError::EmptyName)
	} else if !latin_name.bytes().all(|byte| byte.is_ascii_lowercase()) {
		Err(InferenceProviderError::InvalidLatinName(
			latin_name.to_string(),
		))
	} else {
		Ok(latin_name.to_string())
	}
}

fn clean_display_name(display_name: &str) -> Result<String> {
	let display_name = display_name.trim();
	if display_name.is_empty() {
		Err(InferenceProviderError::EmptyName)
	} else {
		Ok(display_name.to_string())
	}
}

fn ensure_api_key(api_key: &str) -> Result<()> {
	if api_key.trim().is_empty() {
		Err(InferenceProviderError::EmptyApiKey)
	} else {
		Ok(())
	}
}

fn mask_api_key(api_key: &str) -> String {
	let value = api_key.trim();
	let chars = value.chars().collect::<Vec<_>>();
	let len = chars.len();

	if len <= 4 {
		return "*".repeat(len);
	}

	let visible_each = (len / 6).clamp(1, 6);
	let mask_len = len.saturating_sub(visible_each * 2);
	let prefix = chars.iter().take(visible_each).collect::<String>();
	let suffix = chars.iter().skip(len - visible_each).collect::<String>();

	format!("{prefix}{}{suffix}", "*".repeat(mask_len))
}

fn api_key_fingerprint(api_key: &str) -> String {
	// The database fingerprint detects keyring writes that outlive a failed
	// metadata transaction without storing the credential itself.
	let digest = Sha256::digest(api_key.as_bytes());
	let mut fingerprint = String::with_capacity(digest.len() * 2);
	for byte in digest {
		write!(&mut fingerprint, "{byte:02x}")
			.expect("writing to a String cannot fail");
	}
	fingerprint
}

// ============================================================================
// Agent-provider binding table methods
// ============================================================================

/// Data model for an agent-provider binding row.
///
/// Active state is NOT stored here; it is derived by comparing the agent's
/// current config against the bound provider's details.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentProviderBindingRow {
	pub id: String,
	pub agent_id: String,
	pub inference_provider_id: String,
	pub model: Option<String>,
	pub haiku_model: Option<String>,
	pub sonnet_model: Option<String>,
	pub opus_model: Option<String>,
}

/// Model routing values stored on an agent-provider binding.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentProviderBindingModels {
	pub model: Option<String>,
	pub haiku_model: Option<String>,
	pub sonnet_model: Option<String>,
	pub opus_model: Option<String>,
}

/// Partial model routing update for an agent-provider binding.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentProviderBindingModelUpdate {
	pub model: Option<Option<String>>,
	pub haiku_model: Option<Option<String>>,
	pub sonnet_model: Option<Option<String>>,
	pub opus_model: Option<Option<String>>,
}

impl<C: CredentialStore> InferenceProviderStore<C> {
	async fn fetch_agent_binding(
		conn: &mut SqliteConnection,
		agent_id: &str,
		binding_id: &str,
	) -> Result<AgentProviderBindingRow> {
		let row = sqlx::query(
			"SELECT id, agent_id, inference_provider_id, model, \
			 haiku_model, sonnet_model, opus_model \
			 FROM agent_provider_bindings \
			 WHERE agent_id = ? AND id = ?",
		)
		.bind(agent_id)
		.bind(binding_id)
		.fetch_optional(&mut *conn)
		.await?;

		match row {
			Some(row) => Ok(AgentProviderBindingRow {
				id: row.try_get("id")?,
				agent_id: row.try_get("agent_id")?,
				inference_provider_id: row.try_get("inference_provider_id")?,
				model: row.try_get("model")?,
				haiku_model: row.try_get("haiku_model")?,
				sonnet_model: row.try_get("sonnet_model")?,
				opus_model: row.try_get("opus_model")?,
			}),
			None => {
				Err(InferenceProviderError::NotFound(binding_id.to_string()))
			}
		}
	}

	/// List all bindings for a given agent.
	pub fn list_agent_bindings(
		&self,
		agent_id: &str,
	) -> Result<Vec<AgentProviderBindingRow>> {
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let rows = sqlx::query(
				"SELECT id, agent_id, inference_provider_id, model, \
				 haiku_model, sonnet_model, opus_model \
				 FROM agent_provider_bindings \
				 WHERE agent_id = ? \
				 ORDER BY created_at",
			)
			.bind(agent_id)
			.fetch_all(&mut conn)
			.await?;

			rows.into_iter()
				.map(|row| {
					Ok(AgentProviderBindingRow {
						id: row.try_get("id")?,
						agent_id: row.try_get("agent_id")?,
						inference_provider_id: row
							.try_get("inference_provider_id")?,
						model: row.try_get("model")?,
						haiku_model: row.try_get("haiku_model")?,
						sonnet_model: row.try_get("sonnet_model")?,
						opus_model: row.try_get("opus_model")?,
					})
				})
				.collect::<Result<Vec<_>>>()
		})
	}

	/// Get a single binding by its id and agent.
	pub fn get_agent_binding(
		&self,
		agent_id: &str,
		binding_id: &str,
	) -> Result<AgentProviderBindingRow> {
		self.block_on(async {
			let mut conn = self.open_db().await?;
			Self::fetch_agent_binding(&mut conn, agent_id, binding_id).await
		})
	}

	/// Create a binding.
	pub fn create_agent_binding(
		&self,
		agent_id: &str,
		inference_provider_id: &str,
		model: Option<&str>,
	) -> Result<AgentProviderBindingRow> {
		self.create_agent_binding_with_models(
			agent_id,
			inference_provider_id,
			AgentProviderBindingModels {
				model: model.map(ToString::to_string),
				..Default::default()
			},
		)
	}

	/// Create a binding with model routing metadata.
	pub fn create_agent_binding_with_models(
		&self,
		agent_id: &str,
		inference_provider_id: &str,
		models: AgentProviderBindingModels,
	) -> Result<AgentProviderBindingRow> {
		self.block_on(async {
			let mut conn = self.open_db().await?;

			// Verify the inference provider exists.
			let _: InferenceProvider =
				Self::fetch_by_id(&mut conn, inference_provider_id).await?;

			let binding = AgentProviderBindingRow {
				id: uuid::Uuid::new_v4().to_string(),
				agent_id: agent_id.to_string(),
				inference_provider_id: inference_provider_id.to_string(),
				model: models.model,
				haiku_model: models.haiku_model,
				sonnet_model: models.sonnet_model,
				opus_model: models.opus_model,
			};

			sqlx::query(
				"INSERT INTO agent_provider_bindings \
				 (id, agent_id, inference_provider_id, model, \
				  haiku_model, sonnet_model, opus_model) \
				 VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(&binding.id)
			.bind(&binding.agent_id)
			.bind(&binding.inference_provider_id)
			.bind(&binding.model)
			.bind(&binding.haiku_model)
			.bind(&binding.sonnet_model)
			.bind(&binding.opus_model)
			.execute(&mut conn)
			.await?;

			Ok(binding)
		})
	}

	/// Create or replace a binding with an explicit public id.
	pub fn upsert_agent_binding(
		&self,
		agent_id: &str,
		binding_id: &str,
		inference_provider_id: &str,
		model: Option<&str>,
	) -> Result<AgentProviderBindingRow> {
		self.upsert_agent_binding_with_models(
			agent_id,
			binding_id,
			inference_provider_id,
			AgentProviderBindingModels {
				model: model.map(ToString::to_string),
				..Default::default()
			},
		)
	}

	/// Create or replace a binding with model routing metadata.
	pub fn upsert_agent_binding_with_models(
		&self,
		agent_id: &str,
		binding_id: &str,
		inference_provider_id: &str,
		models: AgentProviderBindingModels,
	) -> Result<AgentProviderBindingRow> {
		self.block_on(async {
			let mut conn = self.open_db().await?;

			let _: InferenceProvider =
				Self::fetch_by_id(&mut conn, inference_provider_id).await?;

			let binding = AgentProviderBindingRow {
				id: binding_id.to_string(),
				agent_id: agent_id.to_string(),
				inference_provider_id: inference_provider_id.to_string(),
				model: models.model,
				haiku_model: models.haiku_model,
				sonnet_model: models.sonnet_model,
				opus_model: models.opus_model,
			};

			sqlx::query(
				"INSERT INTO agent_provider_bindings \
				 (id, agent_id, inference_provider_id, model, \
				  haiku_model, sonnet_model, opus_model) \
				 VALUES (?, ?, ?, ?, ?, ?, ?) \
				 ON CONFLICT(agent_id, id) DO UPDATE SET \
				 inference_provider_id = excluded.inference_provider_id, \
				 model = excluded.model, \
				 haiku_model = excluded.haiku_model, \
				 sonnet_model = excluded.sonnet_model, \
				 opus_model = excluded.opus_model, \
				 updated_at = datetime('now')",
			)
			.bind(&binding.id)
			.bind(&binding.agent_id)
			.bind(&binding.inference_provider_id)
			.bind(&binding.model)
			.bind(&binding.haiku_model)
			.bind(&binding.sonnet_model)
			.bind(&binding.opus_model)
			.execute(&mut conn)
			.await?;

			Ok(binding)
		})
	}

	/// Update a binding's model.
	pub fn update_agent_binding(
		&self,
		agent_id: &str,
		binding_id: &str,
		model: Option<Option<String>>,
	) -> Result<AgentProviderBindingRow> {
		self.update_agent_binding_models(
			agent_id,
			binding_id,
			AgentProviderBindingModelUpdate {
				model,
				..Default::default()
			},
		)
	}

	/// Update a binding's model routing metadata.
	pub fn update_agent_binding_models(
		&self,
		agent_id: &str,
		binding_id: &str,
		models: AgentProviderBindingModelUpdate,
	) -> Result<AgentProviderBindingRow> {
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let mut binding =
				Self::fetch_agent_binding(&mut conn, agent_id, binding_id)
					.await?;

			if let Some(model) = models.model {
				binding.model = model;
			}
			if let Some(model) = models.haiku_model {
				binding.haiku_model = model;
			}
			if let Some(model) = models.sonnet_model {
				binding.sonnet_model = model;
			}
			if let Some(model) = models.opus_model {
				binding.opus_model = model;
			}

			sqlx::query(
				"UPDATE agent_provider_bindings \
				 SET model = ?, haiku_model = ?, sonnet_model = ?, \
				     opus_model = ? \
				 WHERE agent_id = ? AND id = ?",
			)
			.bind(&binding.model)
			.bind(&binding.haiku_model)
			.bind(&binding.sonnet_model)
			.bind(&binding.opus_model)
			.bind(agent_id)
			.bind(binding_id)
			.execute(&mut conn)
			.await?;

			Ok(binding)
		})
	}

	/// Delete a binding by id.
	pub fn delete_agent_binding(
		&self,
		agent_id: &str,
		binding_id: &str,
	) -> Result<AgentProviderBindingRow> {
		self.block_on(async {
			let mut conn = self.open_db().await?;
			let binding =
				Self::fetch_agent_binding(&mut conn, agent_id, binding_id)
					.await?;

			sqlx::query(
				"DELETE FROM agent_provider_bindings \
				 WHERE agent_id = ? AND id = ?",
			)
			.bind(agent_id)
			.bind(binding_id)
			.execute(&mut conn)
			.await?;

			Ok(binding)
		})
	}

	/// Build an `AgentProviderBinding` from a binding row + inventory provider.
	pub fn binding_from_row(
		&self,
		row: &AgentProviderBindingRow,
	) -> Result<AgentProviderBinding> {
		let (provider, api_key) =
			self.get_with_api_key(&row.inference_provider_id)?;

		AgentProviderBinding::from_inventory(
			row.id.clone(),
			&provider,
			match api_key {
				Some(_) => AgentProviderCredential::EnvVar {
					name: "AGHUB_INFERENCE_API_KEY".to_string(),
				},
				None => AgentProviderCredential::None,
			},
			AgentProviderSource::Custom,
		)
	}
}

#[cfg(test)]
mod tests {
	use std::collections::HashMap;
	use std::sync::atomic::{AtomicBool, Ordering};
	use std::sync::{mpsc, Arc, Barrier, Mutex};
	use std::time::Duration;

	use super::*;
	use crate::model::InferenceProviderFormat;

	#[derive(Debug, Clone, Default)]
	struct MemoryCredentialStore {
		values: Arc<Mutex<HashMap<String, String>>>,
	}

	impl CredentialStore for MemoryCredentialStore {
		fn get_api_key(&self, provider_id: &str) -> Result<Option<String>> {
			Ok(self.values.lock().unwrap().get(provider_id).cloned())
		}

		fn set_api_key(&self, provider_id: &str, api_key: &str) -> Result<()> {
			self.values
				.lock()
				.unwrap()
				.insert(provider_id.to_string(), api_key.to_string());
			Ok(())
		}

		fn delete_api_key(&self, provider_id: &str) -> Result<()> {
			self.values.lock().unwrap().remove(provider_id);
			Ok(())
		}
	}

	#[derive(Debug, Clone)]
	struct PausingCredentialStore {
		values: MemoryCredentialStore,
		replacement_written: Arc<Barrier>,
		resume_update: Arc<Barrier>,
	}

	impl CredentialStore for PausingCredentialStore {
		fn get_api_key(&self, provider_id: &str) -> Result<Option<String>> {
			self.values.get_api_key(provider_id)
		}

		fn set_api_key(&self, provider_id: &str, api_key: &str) -> Result<()> {
			self.values.set_api_key(provider_id, api_key)?;
			if api_key == "replacement-key" {
				self.replacement_written.wait();
				self.resume_update.wait();
			}
			Ok(())
		}

		fn delete_api_key(&self, provider_id: &str) -> Result<()> {
			self.values.delete_api_key(provider_id)
		}
	}

	#[derive(Debug, Clone)]
	struct PausingReadCredentialStore {
		values: MemoryCredentialStore,
		pause_next_read: Arc<AtomicBool>,
		read_started: Arc<Barrier>,
		resume_read: Arc<Barrier>,
	}

	impl CredentialStore for PausingReadCredentialStore {
		fn get_api_key(&self, provider_id: &str) -> Result<Option<String>> {
			if self.pause_next_read.swap(false, Ordering::SeqCst) {
				self.read_started.wait();
				self.resume_read.wait();
			}
			self.values.get_api_key(provider_id)
		}

		fn set_api_key(&self, provider_id: &str, api_key: &str) -> Result<()> {
			self.values.set_api_key(provider_id, api_key)
		}

		fn delete_api_key(&self, provider_id: &str) -> Result<()> {
			self.values.delete_api_key(provider_id)
		}
	}

	#[derive(Debug, Clone)]
	struct RejectingCredentialStore {
		values: MemoryCredentialStore,
		rejected_api_key: Arc<Mutex<Option<String>>>,
	}

	impl CredentialStore for RejectingCredentialStore {
		fn get_api_key(&self, provider_id: &str) -> Result<Option<String>> {
			self.values.get_api_key(provider_id)
		}

		fn set_api_key(&self, provider_id: &str, api_key: &str) -> Result<()> {
			if self.rejected_api_key.lock().unwrap().as_deref() == Some(api_key)
			{
				return Err(InferenceProviderError::Keyring(
					"credential write rejected".to_string(),
				));
			}
			self.values.set_api_key(provider_id, api_key)
		}

		fn delete_api_key(&self, provider_id: &str) -> Result<()> {
			self.values.delete_api_key(provider_id)
		}
	}

	fn store() -> (
		tempfile::TempDir,
		InferenceProviderStore<MemoryCredentialStore>,
	) {
		let temp = tempfile::tempdir().unwrap();
		let store = InferenceProviderStore::with_credentials(
			temp.path(),
			MemoryCredentialStore::default(),
		);
		(temp, store)
	}

	fn create_provider(
		store: &InferenceProviderStore<MemoryCredentialStore>,
		latin_name: &str,
	) -> InferenceProvider {
		store
			.create(CreateInferenceProvider {
				latin_name: latin_name.to_string(),
				display_name: latin_name.to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "secret".to_string(),
				models: Vec::new(),
			})
			.unwrap()
	}

	#[test]
	fn test_migrates_existing_v6_binding_database() {
		let (temp, store) = store();
		let db_path = temp.path().join(INFERENCE_PROVIDERS_FILE);
		store.block_on(async {
			let mut conn = SqliteConnectOptions::new()
				.filename(&db_path)
				.create_if_missing(true)
				.connect()
				.await
				.unwrap();
			sqlx::query(
				"CREATE TABLE _sqlx_migrations (
					version BIGINT PRIMARY KEY,
					description TEXT NOT NULL,
					installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					success BOOLEAN NOT NULL,
					checksum BLOB NOT NULL,
					execution_time BIGINT NOT NULL
				)",
			)
			.execute(&mut conn)
			.await
			.unwrap();
			sqlx::query(
				"CREATE TABLE inference_providers (
					id TEXT PRIMARY KEY NOT NULL,
					name TEXT NOT NULL UNIQUE,
					format TEXT NOT NULL,
					api_base_url TEXT NOT NULL,
					masked_api_key TEXT NOT NULL DEFAULT '',
					display_name TEXT NOT NULL DEFAULT ''
				)",
			)
			.execute(&mut conn)
			.await
			.unwrap();
			sqlx::query(
				"CREATE TABLE inference_models (
					id TEXT PRIMARY KEY NOT NULL,
					provider_id TEXT NOT NULL,
					name TEXT NOT NULL,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					FOREIGN KEY (provider_id)
						REFERENCES inference_providers(id)
						ON DELETE CASCADE,
					UNIQUE (provider_id, name)
				)",
			)
			.execute(&mut conn)
			.await
			.unwrap();
			sqlx::query(
				"CREATE TABLE agent_provider_bindings (
					id TEXT PRIMARY KEY NOT NULL,
					agent_id TEXT NOT NULL,
					inference_provider_id TEXT NOT NULL,
					model TEXT,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					updated_at TEXT NOT NULL DEFAULT (datetime('now')),
					FOREIGN KEY (inference_provider_id)
						REFERENCES inference_providers(id)
						ON DELETE CASCADE
				)",
			)
			.execute(&mut conn)
			.await
			.unwrap();

			let migrations = [
				(
					1,
					"create inference providers",
					"bf935d5229df4e204f7e0cc2f14721dbfeb45c9a15c229dca50127407ec9fc2311906fa98f567db786f9bf3a4dbc7412",
				),
				(
					2,
					"create inference models",
					"95502c735b08fa0f0074c6885090be68f2b033da1c918e0a825279169faace7fe9fa4fd64b08bf2417f892d65597d0fd",
				),
				(
					3,
					"add masked api key",
					"ff15b82d3ce15332f0ee9c0264db8340326bfa025fb554c32275c33b1be11d29cea5ad4386f4c2c2350e42c61a145b1e",
				),
				(
					4,
					"add display name",
					"5bdac59333690e70da935d043ababf088fe53f7c836a250855472288b38bda5952c3117936bf1b054f662adb3cd7ce48",
				),
				(
					5,
					"create agent provider bindings",
					"14ca7c3e31001e23f4646d99d9dbd27badfcc4bf595eec9ccd4bcbe7bd69e17cae9d5c1eba1ea515764b395c41abf27a",
				),
				(
					6,
					"drop binding is active",
					"a442005806c4fa8c07d3beab28091ede276eea39ea6529df31c1bfa784ea70f14320223fd513d5a84f6121371800417c",
				),
			];
			for (version, description, checksum) in migrations {
				let query = format!(
					"INSERT INTO _sqlx_migrations
						(version, description, success, checksum, execution_time)
					VALUES ({version}, '{description}', 1, x'{checksum}', 0)"
				);
				sqlx::query(sqlx::AssertSqlSafe(query))
					.execute(&mut conn)
					.await
					.unwrap();
			}
		});

		assert!(store.list().unwrap().is_empty());

		store.block_on(async {
			let mut conn = SqliteConnectOptions::new()
				.filename(&db_path)
				.connect()
				.await
				.unwrap();
			let version: i64 =
				sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
					.fetch_one(&mut conn)
					.await
					.unwrap();
			assert_eq!(version, 11);

			let trigger_count: i64 = sqlx::query_scalar(
				"SELECT COUNT(*) FROM sqlite_master
				 WHERE type = 'trigger'
				 AND name = 'trg_agent_provider_bindings_updated_at'",
			)
			.fetch_one(&mut conn)
			.await
			.unwrap();
			assert_eq!(trigger_count, 1);

			let unique_count: i64 = sqlx::query_scalar(
				"SELECT COUNT(*) FROM pragma_index_list(
					'agent_provider_bindings'
				)
				WHERE [unique] = 1",
			)
			.fetch_one(&mut conn)
			.await
			.unwrap();
			assert_eq!(unique_count, 1);
		});
	}

	#[test]
	fn test_list_missing_file_is_empty() {
		let (_temp, store) = store();

		assert!(store.list().unwrap().is_empty());
	}

	#[test]
	fn test_create_stores_metadata_without_api_key() {
		let (_temp, store) = store();

		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "sk-test".to_string(),
				models: Vec::new(),
			})
			.unwrap();

		// Metadata is persisted and retrievable
		let fetched = store.get(&provider.id).unwrap();
		assert_eq!(fetched.latin_name, "openai");
		assert_eq!(fetched.display_name, "OpenAI");
		assert_eq!(fetched.format, InferenceProviderFormat::OpenAiResponses);
		assert_eq!(fetched.api_base_url, "https://api.openai.com/v1");
		assert_eq!(fetched.preset, None);
		assert_eq!(fetched.masked_api_key, "s*****t");
		assert!(fetched.models.is_empty());

		// API key is kept in the credential store, not in provider metadata
		assert!(store
			.list()
			.unwrap()
			.iter()
			.all(|p| { !format!("{p:?}").contains("sk-test") }));
		assert_eq!(
			store.get_api_key(&provider.id).unwrap(),
			Some("sk-test".to_string())
		);
	}

	#[test]
	fn test_create_and_clear_provider_preset() {
		let (_temp, store) = store();
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openrouter".to_string(),
				display_name: "OpenRouter".to_string(),
				format: InferenceProviderFormat::OpenAiCompletions,
				api_base_url: "https://openrouter.ai/api/v1".to_string(),
				preset: Some(" openrouter ".to_string()),
				api_key: "secret".to_string(),
				models: Vec::new(),
			})
			.unwrap();

		assert_eq!(provider.preset.as_deref(), Some("openrouter"));
		assert_eq!(
			store.get(&provider.id).unwrap().preset.as_deref(),
			Some("openrouter")
		);

		let updated = store
			.update(
				&provider.id,
				UpdateInferenceProvider {
					latin_name: None,
					display_name: None,
					format: None,
					api_base_url: None,
					preset: Some(None),
					api_key: None,
					models: None,
				},
			)
			.unwrap();

		assert_eq!(updated.preset, None);
	}

	#[test]
	fn test_mask_api_key_uses_length_ratio() {
		assert_eq!(mask_api_key("abc"), "***");
		assert_eq!(mask_api_key("abcde"), "a***e");
		assert_eq!(mask_api_key("sk-test"), "s*****t");
		assert_eq!(
			mask_api_key("sk-v1-abcdefghijklmnopqrstuvwxyz"),
			"sk-v1**********************vwxyz"
		);
	}

	#[test]
	fn test_update_provider_metadata_and_api_key() {
		let (_temp, store) = store();
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "anthropic".to_string(),
				display_name: "Anthropic".to_string(),
				format: InferenceProviderFormat::Anthropic,
				api_base_url: "https://api.anthropic.com/v1".to_string(),
				preset: None,
				api_key: "first-key".to_string(),
				models: Vec::new(),
			})
			.unwrap();

		let updated = store
			.update(
				&provider.id,
				UpdateInferenceProvider {
					latin_name: Some("claude".to_string()),
					display_name: Some("Claude Team".to_string()),
					format: Some(InferenceProviderFormat::OpenAiCompletions),
					api_base_url: Some(
						"https://gateway.example.com/v1".to_string(),
					),
					preset: None,
					api_key: Some("second-key".to_string()),
					models: None,
				},
			)
			.unwrap();

		assert_eq!(updated.latin_name, "claude");
		assert_eq!(updated.display_name, "Claude Team");
		assert_eq!(updated.format, InferenceProviderFormat::OpenAiCompletions);
		assert_eq!(updated.api_base_url, "https://gateway.example.com/v1");
		assert_eq!(updated.masked_api_key, "s********y");
		assert_eq!(
			store.get_api_key(&provider.id).unwrap(),
			Some("second-key".to_string())
		);
	}

	#[test]
	fn test_update_provider_scope_requires_new_api_key() {
		let (_temp, store) = store();
		let provider = create_provider(&store, "openai");

		for (format, api_base_url) in [
			(Some(InferenceProviderFormat::Anthropic), None),
			(None, Some("https://gateway.example.com/v1".to_string())),
		] {
			let error = store
				.update(
					&provider.id,
					UpdateInferenceProvider {
						latin_name: None,
						display_name: None,
						format,
						api_base_url,
						preset: None,
						api_key: None,
						models: None,
					},
				)
				.unwrap_err();

			assert!(matches!(
				error,
				InferenceProviderError::CredentialScopeChangeRequiresApiKey
			));
			assert_eq!(
				store.get_api_key(&provider.id).unwrap(),
				Some("secret".to_string())
			);
			assert_eq!(store.get(&provider.id).unwrap(), provider);
		}
	}

	#[test]
	fn test_update_provider_can_keep_key_for_unchanged_scope() {
		let (_temp, store) = store();
		let provider = create_provider(&store, "openai");

		let updated = store
			.update(
				&provider.id,
				UpdateInferenceProvider {
					latin_name: None,
					display_name: Some("OpenAI Team".to_string()),
					format: Some(InferenceProviderFormat::OpenAiResponses),
					api_base_url: Some(
						" https://api.openai.com/v1 ".to_string(),
					),
					preset: None,
					api_key: None,
					models: None,
				},
			)
			.unwrap();

		assert_eq!(updated.display_name, "OpenAI Team");
		assert_eq!(
			store.get_api_key(&provider.id).unwrap(),
			Some("secret".to_string())
		);
	}

	#[test]
	fn test_update_rolls_back_metadata_models_and_api_key_together() {
		let (_temp, store) = store();
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "first-key".to_string(),
				models: vec!["first-model".to_string()],
			})
			.unwrap();
		store.block_on(async {
			let mut conn = store.open_db().await.unwrap();
			sqlx::query(
				"CREATE TRIGGER reject_model_update \
				 BEFORE INSERT ON inference_models \
				 BEGIN SELECT RAISE(FAIL, 'model update rejected'); END",
			)
			.execute(&mut conn)
			.await
			.unwrap();
		});

		let result = store.update(
			&provider.id,
			UpdateInferenceProvider {
				latin_name: None,
				display_name: Some("Changed".to_string()),
				format: None,
				api_base_url: Some("https://other.example.com/v1".to_string()),
				preset: None,
				api_key: Some("replacement-key".to_string()),
				models: Some(vec!["second-model".to_string()]),
			},
		);

		assert!(result.is_err());
		assert_eq!(store.get(&provider.id).unwrap(), provider);
		assert_eq!(
			store.get_api_key(&provider.id).unwrap().as_deref(),
			Some("first-key")
		);
	}

	#[test]
	fn test_failed_key_compensation_quarantines_the_credential() {
		let temp = tempfile::tempdir().unwrap();
		let rejected_api_key = Arc::new(Mutex::new(None));
		let store = InferenceProviderStore::with_credentials(
			temp.path(),
			RejectingCredentialStore {
				values: MemoryCredentialStore::default(),
				rejected_api_key: rejected_api_key.clone(),
			},
		);
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "first-key".to_string(),
				models: vec!["first-model".to_string()],
			})
			.unwrap();
		*rejected_api_key.lock().unwrap() = Some("first-key".to_string());
		store.block_on(async {
			let mut conn = store.open_db().await.unwrap();
			sqlx::query(
				"CREATE TRIGGER reject_model_update \
				 BEFORE INSERT ON inference_models \
				 BEGIN SELECT RAISE(FAIL, 'model update rejected'); END",
			)
			.execute(&mut conn)
			.await
			.unwrap();
		});

		let result = store.update(
			&provider.id,
			UpdateInferenceProvider {
				latin_name: None,
				display_name: None,
				format: None,
				api_base_url: Some("https://other.example.com/v1".to_string()),
				preset: None,
				api_key: Some("replacement-key".to_string()),
				models: Some(vec!["second-model".to_string()]),
			},
		);

		assert!(matches!(
			result,
			Err(InferenceProviderError::CredentialStateUnavailable)
		));
		assert_eq!(store.get(&provider.id).unwrap(), provider);
		assert!(matches!(
			store.get_with_api_key(&provider.id),
			Err(InferenceProviderError::CredentialStateUnavailable)
		));
	}

	#[test]
	fn test_failed_provider_delete_quarantines_legacy_credential() {
		let temp = tempfile::tempdir().unwrap();
		let rejected_api_key = Arc::new(Mutex::new(None));
		let store = InferenceProviderStore::with_credentials(
			temp.path(),
			RejectingCredentialStore {
				values: MemoryCredentialStore::default(),
				rejected_api_key: rejected_api_key.clone(),
			},
		);
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "first-key".to_string(),
				models: Vec::new(),
			})
			.unwrap();
		store.block_on(async {
			let mut conn = store.open_db().await.unwrap();
			sqlx::query(
				"UPDATE inference_providers \
				 SET credential_fingerprint = NULL WHERE id = ?",
			)
			.bind(&provider.id)
			.execute(&mut conn)
			.await
			.unwrap();
			sqlx::query(
				"CREATE TRIGGER reject_provider_delete \
				 BEFORE DELETE ON inference_providers \
				 BEGIN SELECT RAISE(FAIL, 'provider delete rejected'); END",
			)
			.execute(&mut conn)
			.await
			.unwrap();
		});
		*rejected_api_key.lock().unwrap() = Some("first-key".to_string());

		assert!(matches!(
			store.delete(&provider.id),
			Err(InferenceProviderError::CredentialStateUnavailable)
		));
		assert!(matches!(
			store.get_with_api_key(&provider.id),
			Err(InferenceProviderError::CredentialStateUnavailable)
		));
	}

	#[test]
	fn test_failed_api_key_delete_quarantines_legacy_credential() {
		let temp = tempfile::tempdir().unwrap();
		let rejected_api_key = Arc::new(Mutex::new(None));
		let store = InferenceProviderStore::with_credentials(
			temp.path(),
			RejectingCredentialStore {
				values: MemoryCredentialStore::default(),
				rejected_api_key: rejected_api_key.clone(),
			},
		);
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "first-key".to_string(),
				models: Vec::new(),
			})
			.unwrap();
		store.block_on(async {
			let mut conn = store.open_db().await.unwrap();
			sqlx::query(
				"UPDATE inference_providers \
				 SET credential_fingerprint = NULL WHERE id = ?",
			)
			.bind(&provider.id)
			.execute(&mut conn)
			.await
			.unwrap();
			sqlx::query(
				"CREATE TRIGGER reject_api_key_delete \
				 BEFORE UPDATE OF masked_api_key ON inference_providers \
				 WHEN NEW.masked_api_key = '' \
				 BEGIN SELECT RAISE(FAIL, 'key delete rejected'); END",
			)
			.execute(&mut conn)
			.await
			.unwrap();
		});
		*rejected_api_key.lock().unwrap() = Some("first-key".to_string());

		assert!(matches!(
			store.delete_api_key(&provider.id),
			Err(InferenceProviderError::CredentialStateUnavailable)
		));
		assert!(matches!(
			store.get_with_api_key(&provider.id),
			Err(InferenceProviderError::CredentialStateUnavailable)
		));
	}

	#[test]
	fn test_legacy_credential_without_fingerprint_remains_readable() {
		let (_temp, store) = store();
		let provider = create_provider(&store, "openai");
		store.block_on(async {
			let mut conn = store.open_db().await.unwrap();
			sqlx::query(
				"UPDATE inference_providers \
				 SET credential_fingerprint = NULL WHERE id = ?",
			)
			.bind(&provider.id)
			.execute(&mut conn)
			.await
			.unwrap();
		});

		assert_eq!(
			store.get_api_key(&provider.id).unwrap().as_deref(),
			Some("secret")
		);
	}

	#[test]
	fn test_scope_update_and_credential_snapshot_are_serialized() {
		const SNAPSHOT_WAIT: Duration = Duration::from_millis(100);

		let temp = tempfile::tempdir().unwrap();
		let replacement_written = Arc::new(Barrier::new(2));
		let resume_update = Arc::new(Barrier::new(2));
		let store = InferenceProviderStore::with_credentials(
			temp.path(),
			PausingCredentialStore {
				values: MemoryCredentialStore::default(),
				replacement_written: replacement_written.clone(),
				resume_update: resume_update.clone(),
			},
		);
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.example.com/v1".to_string(),
				preset: None,
				api_key: "first-key".to_string(),
				models: Vec::new(),
			})
			.unwrap();

		let update_store = store.clone();
		let provider_id = provider.id.clone();
		let update = std::thread::spawn(move || {
			update_store.update(
				&provider_id,
				UpdateInferenceProvider {
					latin_name: None,
					display_name: None,
					format: None,
					api_base_url: Some(
						"https://other.example.com/v1".to_string(),
					),
					preset: None,
					api_key: Some("replacement-key".to_string()),
					models: None,
				},
			)
		});
		replacement_written.wait();

		let snapshot_store = store.clone();
		let provider_id = provider.id.clone();
		let (snapshot_tx, snapshot_rx) = mpsc::channel();
		let snapshot_started = Arc::new(Barrier::new(2));
		let reader_started = snapshot_started.clone();
		std::thread::spawn(move || {
			reader_started.wait();
			snapshot_tx
				.send(snapshot_store.get_with_api_key(&provider_id))
				.unwrap();
		});
		snapshot_started.wait();
		let early_snapshot = snapshot_rx.recv_timeout(SNAPSHOT_WAIT);

		resume_update.wait();
		let updated = update.join().unwrap().unwrap();
		let snapshot_was_blocked = early_snapshot.is_err();
		let (snapshot_provider, snapshot_key) = early_snapshot
			.unwrap_or_else(|_| snapshot_rx.recv().unwrap())
			.unwrap();

		assert!(snapshot_was_blocked);
		assert_eq!(snapshot_provider, updated);
		assert_eq!(snapshot_key.as_deref(), Some("replacement-key"));
	}

	#[test]
	fn test_legacy_snapshot_is_checkpointed_across_store_instances() {
		const UPDATE_WAIT: Duration = Duration::from_millis(100);

		let temp = tempfile::tempdir().unwrap();
		let pause_next_read = Arc::new(AtomicBool::new(false));
		let read_started = Arc::new(Barrier::new(2));
		let resume_read = Arc::new(Barrier::new(2));
		let credentials = PausingReadCredentialStore {
			values: MemoryCredentialStore::default(),
			pause_next_read: pause_next_read.clone(),
			read_started: read_started.clone(),
			resume_read: resume_read.clone(),
		};
		let reader = InferenceProviderStore::with_credentials(
			temp.path(),
			credentials.clone(),
		);
		let writer =
			InferenceProviderStore::with_credentials(temp.path(), credentials);
		let provider = reader
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.example.com/v1".to_string(),
				preset: None,
				api_key: "first-key".to_string(),
				models: Vec::new(),
			})
			.unwrap();
		reader.block_on(async {
			let mut conn = reader.open_db().await.unwrap();
			sqlx::query(
				"UPDATE inference_providers \
				 SET credential_fingerprint = NULL WHERE id = ?",
			)
			.bind(&provider.id)
			.execute(&mut conn)
			.await
			.unwrap();
		});

		pause_next_read.store(true, Ordering::SeqCst);
		let reader_id = provider.id.clone();
		let read =
			std::thread::spawn(move || reader.get_with_api_key(&reader_id));
		read_started.wait();

		let writer_id = provider.id.clone();
		let (update_tx, update_rx) = mpsc::channel();
		std::thread::spawn(move || {
			update_tx
				.send(writer.update(
					&writer_id,
					UpdateInferenceProvider {
						latin_name: None,
						display_name: None,
						format: None,
						api_base_url: Some(
							"https://other.example.com/v1".to_string(),
						),
						preset: None,
						api_key: Some("replacement-key".to_string()),
						models: None,
					},
				))
				.unwrap();
		});
		let early_update = update_rx.recv_timeout(UPDATE_WAIT);
		let update_was_blocked = early_update.is_err();

		resume_read.wait();
		let read_result = read.join().unwrap();
		let updated = early_update
			.unwrap_or_else(|_| update_rx.recv().unwrap())
			.unwrap();

		assert!(update_was_blocked);
		match read_result {
			Ok((read_provider, Some(api_key))) => {
				let old_snapshot = read_provider.api_base_url
					== "https://api.example.com/v1"
					&& api_key == "first-key";
				let updated_snapshot = read_provider.api_base_url
					== updated.api_base_url
					&& api_key == "replacement-key";
				assert!(old_snapshot || updated_snapshot);
			}
			Err(InferenceProviderError::CredentialStateUnavailable) => {}
			result => panic!("unexpected credential snapshot: {result:?}"),
		}
	}

	#[test]
	fn test_delete_provider_and_api_key() {
		let (_temp, store) = store();
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "anthropic".to_string(),
				display_name: "Anthropic".to_string(),
				format: InferenceProviderFormat::Anthropic,
				api_base_url: "https://api.anthropic.com/v1".to_string(),
				preset: None,
				api_key: "secret".to_string(),
				models: Vec::new(),
			})
			.unwrap();

		let deleted = store.delete(&provider.id).unwrap();

		assert_eq!(deleted.id, provider.id);
		assert!(store.list().unwrap().is_empty());
		assert_eq!(store.credentials.get_api_key(&provider.id).unwrap(), None);
	}

	#[test]
	fn test_set_and_delete_api_key_updates_masked_preview() {
		let (_temp, store) = store();
		let provider = create_provider(&store, "openai");

		store.set_api_key(&provider.id, "replacement-key").unwrap();
		assert_eq!(
			store.get(&provider.id).unwrap().masked_api_key,
			"re***********ey"
		);

		store.delete_api_key(&provider.id).unwrap();
		assert_eq!(store.get(&provider.id).unwrap().masked_api_key, "");
	}

	#[test]
	fn test_duplicate_name_is_rejected() {
		let (_temp, store) = store();
		store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "first".to_string(),
				models: Vec::new(),
			})
			.unwrap();

		let error = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI Gateway".to_string(),
				format: InferenceProviderFormat::OpenAiCompletions,
				api_base_url: "https://gateway.example.com/v1".to_string(),
				preset: None,
				api_key: "second".to_string(),
				models: Vec::new(),
			})
			.unwrap_err();

		assert!(matches!(error, InferenceProviderError::AlreadyExists(_)));
	}

	#[test]
	fn test_invalid_latin_name_is_rejected() {
		let (_temp, store) = store();

		for latin_name in ["OpenAI", "openai1", "open_ai", "open-ai", "兔子"]
		{
			let error = store
				.create(CreateInferenceProvider {
					latin_name: latin_name.to_string(),
					display_name: "OpenAI".to_string(),
					format: InferenceProviderFormat::OpenAiResponses,
					api_base_url: "https://api.openai.com/v1".to_string(),
					preset: None,
					api_key: "secret".to_string(),
					models: Vec::new(),
				})
				.unwrap_err();

			assert!(matches!(
				error,
				InferenceProviderError::InvalidLatinName(_)
			));
		}
	}

	#[test]
	fn test_empty_api_base_url_is_rejected() {
		let (_temp, store) = store();

		let error = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: " ".to_string(),
				preset: None,
				api_key: "secret".to_string(),
				models: Vec::new(),
			})
			.unwrap_err();

		assert!(matches!(error, InferenceProviderError::EmptyApiBaseUrl));
	}

	#[test]
	fn test_create_normalizes_provider_api_base_url() {
		let (_temp, store) = store();

		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: " api.example.com/v1/chat/completions "
					.to_string(),
				preset: None,
				api_key: "secret".to_string(),
				models: Vec::new(),
			})
			.unwrap();

		assert_eq!(provider.api_base_url, "https://api.example.com/v1");
	}

	#[test]
	fn test_create_rejects_unsupported_provider_api_base_url() {
		for (latin_name, api_base_url) in [
			("ftp", "ftp://api.example.com/v1"),
			("userinfo", "https://user:secret@api.example.com/v1"),
		] {
			let (_temp, store) = store();
			let result = store.create(CreateInferenceProvider {
				latin_name: latin_name.to_string(),
				display_name: latin_name.to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: api_base_url.to_string(),
				preset: None,
				api_key: "secret".to_string(),
				models: Vec::new(),
			});

			assert!(result.is_err());
		}
	}

	#[test]
	fn test_update_rejects_unsupported_provider_api_base_url() {
		let (_temp, store) = store();
		let provider = create_provider(&store, "openai");

		let result = store.update(
			&provider.id,
			UpdateInferenceProvider {
				latin_name: None,
				display_name: None,
				format: None,
				api_base_url: Some("ftp://api.example.com/v1".to_string()),
				preset: None,
				api_key: Some("replacement".to_string()),
				models: None,
			},
		);

		assert!(result.is_err());
		assert_eq!(store.get(&provider.id).unwrap(), provider);
	}

	#[test]
	fn test_create_and_list_provider_models() {
		let (_temp, store) = store();
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "secret".to_string(),
				models: vec![
					" gpt-5.4 ".to_string(),
					"gpt-5.4-mini".to_string(),
				],
			})
			.unwrap();

		assert_eq!(
			provider.models,
			vec!["gpt-5.4".to_string(), "gpt-5.4-mini".to_string()]
		);
		assert_eq!(store.get(&provider.id).unwrap().models, provider.models);
		assert_eq!(store.list().unwrap()[0].models, provider.models);
	}

	#[test]
	fn test_provider_model_names_are_unique_case_insensitive() {
		let (_temp, store) = store();

		let error = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "secret".to_string(),
				models: vec!["gpt-5.4".to_string(), "GPT-5.4".to_string()],
			})
			.unwrap_err();

		assert!(matches!(
			error,
			InferenceProviderError::ModelAlreadyExists(_)
		));
	}

	#[test]
	fn test_update_and_delete_provider_model() {
		let (_temp, store) = store();
		let provider = create_provider(&store, "openai");

		let updated = store
			.update(
				&provider.id,
				UpdateInferenceProvider {
					latin_name: None,
					display_name: None,
					format: None,
					api_base_url: None,
					preset: None,
					api_key: None,
					models: Some(vec!["gpt-5.5".to_string()]),
				},
			)
			.unwrap();

		assert_eq!(updated.models, vec!["gpt-5.5".to_string()]);
		assert_eq!(store.get(&provider.id).unwrap().models, updated.models);

		let updated = store
			.update(
				&provider.id,
				UpdateInferenceProvider {
					latin_name: None,
					display_name: None,
					format: None,
					api_base_url: None,
					preset: None,
					api_key: None,
					models: Some(Vec::new()),
				},
			)
			.unwrap();

		assert!(updated.models.is_empty());
		assert!(store.get(&provider.id).unwrap().models.is_empty());
	}

	#[test]
	fn test_delete_provider_cascades_models() {
		let (_temp, store) = store();
		let provider = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "secret".to_string(),
				models: vec!["gpt-5.4".to_string()],
			})
			.unwrap();

		store.delete(&provider.id).unwrap();

		store.block_on(async {
			let mut conn = store.open_db().await.unwrap();
			let count: i64 =
				sqlx::query_scalar("SELECT COUNT(*) FROM inference_models")
					.fetch_one(&mut conn)
					.await
					.unwrap();
			assert_eq!(count, 0);
		});
	}

	#[test]
	fn test_empty_model_name_is_rejected() {
		let (_temp, store) = store();

		let error = store
			.create(CreateInferenceProvider {
				latin_name: "openai".to_string(),
				display_name: "OpenAI".to_string(),
				format: InferenceProviderFormat::OpenAiResponses,
				api_base_url: "https://api.openai.com/v1".to_string(),
				preset: None,
				api_key: "secret".to_string(),
				models: vec![" ".to_string()],
			})
			.unwrap_err();

		assert!(matches!(error, InferenceProviderError::EmptyModelName));
	}
}

mod acquisition;
mod discovery;
pub(crate) mod process;
mod registry;
mod storage;

use crate::{
	CcusageRuntimeCandidateDto, CcusageRuntimeDto, CcusageRuntimeExecutableDto,
	CcusageRuntimeSource, InstallCcusageRuntimeRequest,
	SetCcusageRuntimeRequest, UsageStatusDto,
};
use registry::CcusageRegistry;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use thiserror::Error;

// A runner may use its 180-second timeout. Five minutes still leaves a
// fallback attempt without accumulating every Auto source's worst case.
const RUNTIME_OPERATION_TIMEOUT: Duration = Duration::from_secs(5 * 60);
// Selection and refresh only probe local executables. One minute bounds stale
// installation scans while allowing several 10-second version probes.
const RUNTIME_PROBE_OPERATION_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", content = "path", rename_all = "snake_case")]
pub enum CcusageRuntimePreference {
	Auto,
	Manual(PathBuf),
	Path,
	Bun,
	Npm,
	Download,
	Bundled,
}

impl CcusageRuntimePreference {
	pub fn source(&self) -> CcusageRuntimeSource {
		match self {
			Self::Auto => CcusageRuntimeSource::Auto,
			Self::Manual(_) => CcusageRuntimeSource::Manual,
			Self::Path => CcusageRuntimeSource::Path,
			Self::Bun => CcusageRuntimeSource::Bun,
			Self::Npm => CcusageRuntimeSource::Npm,
			Self::Download => CcusageRuntimeSource::Download,
			Self::Bundled => CcusageRuntimeSource::Bundled,
		}
	}
}

impl TryFrom<SetCcusageRuntimeRequest> for CcusageRuntimePreference {
	type Error = CcusageRuntimeError;

	fn try_from(
		request: SetCcusageRuntimeRequest,
	) -> Result<Self, Self::Error> {
		match request.source {
			CcusageRuntimeSource::Auto => Ok(Self::Auto),
			CcusageRuntimeSource::Manual => request
				.path
				.map(|path| path.trim().to_string())
				.filter(|path| !path.is_empty())
				.map(PathBuf::from)
				.map(Self::Manual)
				.ok_or(CcusageRuntimeError::ManualPathRequired),
			CcusageRuntimeSource::Path => Ok(Self::Path),
			CcusageRuntimeSource::Bun => Ok(Self::Bun),
			CcusageRuntimeSource::Npm => Ok(Self::Npm),
			CcusageRuntimeSource::Download => Ok(Self::Download),
			CcusageRuntimeSource::Bundled => Ok(Self::Bundled),
			CcusageRuntimeSource::Environment => {
				Err(CcusageRuntimeError::EnvironmentCannotBeSelected)
			}
		}
	}
}

#[derive(Debug, Error)]
pub enum CcusageRuntimeError {
	#[error("no usable ccusage runtime was found")]
	NoRuntime,
	#[error("ccusage source {0:?} is unavailable")]
	SourceUnavailable(CcusageRuntimeSource),
	#[error("ccusage source {0:?} is not installed")]
	SourceNotInstalled(CcusageRuntimeSource),
	#[error("ccusage source {0:?} cannot be installed by aghub")]
	SourceCannotInstall(CcusageRuntimeSource),
	#[error("ccusage source {0:?} cannot be updated by aghub")]
	SourceCannotUpdate(CcusageRuntimeSource),
	#[error("a custom ccusage path is required")]
	ManualPathRequired,
	#[error("the environment override cannot be selected or persisted")]
	EnvironmentCannotBeSelected,
	#[error("invalid ccusage binary: {0}")]
	InvalidBinary(String),
	#[error("ccusage version probe timed out: {0}")]
	VersionProbeTimedOut(PathBuf),
	#[error("failed to spawn ccusage at {path}: {error}")]
	Spawn {
		path: PathBuf,
		#[source]
		error: std::io::Error,
	},
	#[error("{0:?} installation timed out")]
	InstallTimedOut(CcusageRuntimeSource),
	#[error("ccusage runtime operation timed out")]
	RuntimeOperationTimedOut,
	#[error("{provider:?} installation failed: {message}")]
	PackageInstallFailed {
		provider: CcusageRuntimeSource,
		message: String,
	},
	#[error("unsupported ccusage platform {os}/{arch}")]
	UnsupportedPlatform { os: String, arch: String },
	#[error("ccusage package archive is too large")]
	ArchiveTooLarge,
	#[error("ccusage package integrity mismatch")]
	IntegrityMismatch,
	#[error("ccusage package is missing archive member {0}")]
	MissingArchiveMember(String),
	#[error("ccusage archive member is not a regular file: {0}")]
	InvalidArchiveMember(String),
	#[error("invalid ccusage registry metadata: {0}")]
	InvalidRegistryMetadata(String),
	#[error("invalid ccusage runtime config: {0}")]
	InvalidRuntimeConfig(String),
	#[error("ccusage runtime state lock is poisoned")]
	StatePoisoned,
	#[error(transparent)]
	Io(#[from] std::io::Error),
	#[error(transparent)]
	Json(#[from] serde_json::Error),
	#[error(transparent)]
	Http(#[from] reqwest::Error),
}

impl CcusageRuntimeError {
	pub fn client_message(&self) -> String {
		match self {
			Self::InvalidBinary(_) => {
				"the selected ccusage executable is invalid".to_string()
			}
			Self::VersionProbeTimedOut(_) => {
				"the ccusage version check timed out".to_string()
			}
			Self::Spawn { .. } => {
				"the selected ccusage executable could not be started"
					.to_string()
			}
			Self::PackageInstallFailed { provider, .. } => {
				format!("{provider:?} could not install ccusage")
			}
			Self::Io(_) | Self::Json(_) => {
				"the ccusage runtime state could not be read or written"
					.to_string()
			}
			Self::Http(_) => "the ccusage registry request failed".to_string(),
			_ => self.to_string(),
		}
	}
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeCandidate {
	pub source: CcusageRuntimeSource,
	pub path: PathBuf,
	pub version: String,
}

#[derive(Clone, Debug)]
pub struct CcusageExecutable {
	pub source: CcusageRuntimeSource,
	pub path: PathBuf,
	pub version: String,
}

#[derive(Clone, Copy)]
struct AcquisitionAvailability {
	bun: bool,
	npm: bool,
	download: bool,
}

impl AcquisitionAvailability {
	fn can_install(self, source: CcusageRuntimeSource) -> bool {
		match source {
			CcusageRuntimeSource::Bun => self.bun,
			CcusageRuntimeSource::Npm => self.npm,
			CcusageRuntimeSource::Download => self.download,
			_ => false,
		}
	}

	fn any(self) -> bool {
		self.bun || self.npm || self.download
	}
}

pub struct CcusageRuntime {
	root: PathBuf,
	bundled: Option<PathBuf>,
	preference: RwLock<CcusageRuntimePreference>,
	configuration_error: RwLock<Option<String>>,
	active: RwLock<Option<Arc<CcusageExecutable>>>,
	operation: tokio::sync::Mutex<()>,
	registry: Option<CcusageRegistry>,
}

impl CcusageRuntime {
	pub fn load(
		root: PathBuf,
		bundled: Option<PathBuf>,
		legacy_preference: Option<CcusageRuntimePreference>,
	) -> Arc<Self> {
		let (stored, configuration_error) =
			match storage::load_preference(&root) {
				Ok(value) => (value, None),
				Err(error) => {
					log::warn!(
						"failed to read ccusage runtime preference: {error}"
					);
					(None, Some(error.client_message()))
				}
			};
		let should_migrate = configuration_error.is_none()
			&& stored.is_none()
			&& legacy_preference.is_some();
		let preference = stored
			.or_else(|| {
				configuration_error
					.is_none()
					.then_some(legacy_preference)
					.flatten()
			})
			.unwrap_or(CcusageRuntimePreference::Auto);
		if should_migrate {
			if let Err(error) = storage::save_preference(&root, &preference) {
				log::warn!(
					"failed to migrate ccusage runtime preference: {error}"
				);
			}
		}
		let registry = CcusageRegistry::new()
			.inspect_err(|error| {
				log::warn!(
					"failed to initialize ccusage registry client: {error}"
				)
			})
			.ok();
		Arc::new(Self {
			root,
			bundled,
			preference: RwLock::new(preference),
			configuration_error: RwLock::new(configuration_error),
			active: RwLock::new(None),
			operation: tokio::sync::Mutex::new(()),
			registry,
		})
	}

	pub fn preference(
		&self,
	) -> Result<CcusageRuntimePreference, CcusageRuntimeError> {
		self.preference
			.read()
			.map(|preference| preference.clone())
			.map_err(|_| CcusageRuntimeError::StatePoisoned)
	}

	pub async fn snapshot(
		&self,
	) -> Result<Arc<CcusageExecutable>, CcusageRuntimeError> {
		if let Some(active) = self.active_snapshot()? {
			return self.reprobe_active(active).await;
		}
		let _guard = self.operation.lock().await;
		if let Some(active) = self.active_snapshot()? {
			return self.reprobe_active(active).await;
		}
		let candidate = self.resolve_current_preference().await?;
		self.set_active(candidate)
	}

	pub async fn refresh(
		&self,
	) -> Result<CcusageRuntimeDto, CcusageRuntimeError> {
		with_operation_timeout(RUNTIME_PROBE_OPERATION_TIMEOUT, async {
			let _guard = self.operation.lock().await;
			match self.resolve_current_preference().await {
				Ok(candidate) => {
					self.set_active(candidate)?;
				}
				Err(error) => {
					self.clear_active()?;
					return Err(error);
				}
			}
			Ok(())
		})
		.await?;
		self.describe().await
	}

	pub async fn select(
		&self,
		request: SetCcusageRuntimeRequest,
	) -> Result<CcusageRuntimeDto, CcusageRuntimeError> {
		let preference = CcusageRuntimePreference::try_from(request)?;
		with_operation_timeout(RUNTIME_PROBE_OPERATION_TIMEOUT, async {
			let _guard = self.operation.lock().await;
			let candidate = discovery::resolve_preference(
				&self.root,
				self.bundled.as_deref(),
				&preference,
			)
			.await;
			let candidate = match candidate {
				Ok(candidate) => Some(candidate),
				Err(_)
					if matches!(preference, CcusageRuntimePreference::Auto) =>
				{
					None
				}
				Err(error) => return Err(error),
			};
			storage::save_preference(&self.root, &preference)?;
			*self
				.preference
				.write()
				.map_err(|_| CcusageRuntimeError::StatePoisoned)? = preference;
			self.clear_configuration_error()?;
			match candidate {
				Some(candidate) => {
					self.set_active(candidate)?;
				}
				None => self.clear_active()?,
			}
			Ok(())
		})
		.await?;
		self.describe().await
	}

	pub async fn install(
		&self,
		request: InstallCcusageRuntimeRequest,
	) -> Result<CcusageRuntimeDto, CcusageRuntimeError> {
		with_operation_deadline(async {
			let _guard = self.operation.lock().await;
			let active_source =
				if std::env::var_os("AGHUB_CCUSAGE_BIN").is_some() {
					Some(self.resolve_current_preference().await?.source)
				} else if let Some(active) = self.active_snapshot()? {
					Some(active.source)
				} else {
					match self.resolve_current_preference().await {
						Ok(candidate) => Some(candidate.source),
						Err(error) => {
							log::warn!(
								"no active ccusage runtime before automatic installation: {error}"
							);
							None
						}
					}
				};
			if request.source == CcusageRuntimeSource::Auto {
				self.install_preferred_locked(auto_install_preference(
					active_source,
				))
				.await?;
			} else {
				let preference = preference_for_source(request.source)?;
				self.install_locked(request.source, preference).await?;
			}
			Ok(())
		})
		.await?;
		self.describe().await
	}

	pub async fn update(
		&self,
	) -> Result<CcusageRuntimeDto, CcusageRuntimeError> {
		with_operation_deadline(async {
			let _guard = self.operation.lock().await;
			let preference = self.preference()?;
			let active = match self.active_snapshot()? {
				Some(active) => active,
				None => {
					let candidate = self.resolve_current_preference().await?;
					self.set_active(candidate)?
				}
			};
			match active.source {
				CcusageRuntimeSource::Bun
				| CcusageRuntimeSource::Npm
				| CcusageRuntimeSource::Download => {
					self.install_locked(active.source, preference).await?;
				}
				CcusageRuntimeSource::Bundled => {
					let preserved = if matches!(
						&preference,
						CcusageRuntimePreference::Auto
					) {
						Some(preference)
					} else {
						None
					};
					self.install_preferred_locked(preserved).await?;
				}
				_ => {
					return Err(CcusageRuntimeError::SourceCannotUpdate(
						active.source,
					));
				}
			}
			Ok(())
		})
		.await?;
		self.describe().await
	}

	pub async fn describe(
		&self,
	) -> Result<CcusageRuntimeDto, CcusageRuntimeError> {
		let (snapshot, latest, acquisition) = tokio::join!(
			self.snapshot(),
			self.latest_version(),
			self.acquisition_availability(),
		);
		let error = self.configuration_error_message()?.or_else(|| {
			snapshot
				.as_ref()
				.err()
				.map(CcusageRuntimeError::client_message)
		});
		let active = snapshot.ok();
		let update_available =
			active.as_ref().zip(latest.as_ref()).is_some_and(
				|(active, latest)| version_is_older(&active.version, latest),
			);
		let preference = self.preference()?;
		let active_dto = active.as_deref().map(|active| {
			executable_dto(active, self.can_update_active(active, acquisition))
		});
		Ok(CcusageRuntimeDto {
			preference: preference.source(),
			active: active_dto,
			candidates: self
				.candidate_dtos(active.as_deref(), acquisition)
				.await,
			latest_version: latest.map(|version| version.to_string()),
			update_available,
			error,
		})
	}

	pub async fn status(&self) -> UsageStatusDto {
		let (snapshot, latest, acquisition) = tokio::join!(
			self.snapshot(),
			self.latest_version(),
			self.acquisition_availability(),
		);
		let configuration_error = self
			.configuration_error_message()
			.unwrap_or_else(|error| Some(error.client_message()));
		let (version, source, reachable, runtime_error, can_update) =
			match snapshot {
				Ok(active) => (
					Some(active.version.clone()),
					Some(active.source),
					true,
					None,
					self.can_update_active(&active, acquisition),
				),
				Err(error) => {
					(None, None, false, Some(error.client_message()), false)
				}
			};
		let error = configuration_error.or(runtime_error);
		let update_available = version
			.as_deref()
			.zip(latest.as_ref())
			.is_some_and(|(version, latest)| version_is_older(version, latest));
		UsageStatusDto {
			version,
			reachable,
			error,
			latest_version: latest.map(|version| version.to_string()),
			update_available,
			source,
			can_install: acquisition.any(),
			can_update,
		}
	}

	async fn resolve_current_preference(
		&self,
	) -> Result<RuntimeCandidate, CcusageRuntimeError> {
		let preference = self.preference()?;
		if std::env::var_os("AGHUB_CCUSAGE_BIN").is_some() {
			return discovery::resolve_preference(
				&self.root,
				self.bundled.as_deref(),
				&preference,
			)
			.await;
		}
		if let Some(error) = self
			.configuration_error
			.read()
			.map_err(|_| CcusageRuntimeError::StatePoisoned)?
			.as_ref()
		{
			return Err(CcusageRuntimeError::InvalidRuntimeConfig(
				error.clone(),
			));
		}
		discovery::resolve_preference(
			&self.root,
			self.bundled.as_deref(),
			&preference,
		)
		.await
	}

	async fn reprobe_active(
		&self,
		active: Arc<CcusageExecutable>,
	) -> Result<Arc<CcusageExecutable>, CcusageRuntimeError> {
		match discovery::candidate_from_path(active.source, active.path.clone())
			.await
		{
			Ok(candidate) => {
				let refreshed = Arc::new(CcusageExecutable {
					source: candidate.source,
					path: candidate.path,
					version: candidate.version,
				});
				let mut current = self
					.active
					.write()
					.map_err(|_| CcusageRuntimeError::StatePoisoned)?;
				if current
					.as_ref()
					.is_some_and(|current| Arc::ptr_eq(current, &active))
				{
					*current = Some(refreshed.clone());
				}
				Ok(refreshed)
			}
			Err(error) => {
				let mut current = self
					.active
					.write()
					.map_err(|_| CcusageRuntimeError::StatePoisoned)?;
				if current
					.as_ref()
					.is_some_and(|current| Arc::ptr_eq(current, &active))
				{
					*current = None;
				}
				Err(error)
			}
		}
	}

	async fn install_locked(
		&self,
		source: CcusageRuntimeSource,
		preference: CcusageRuntimePreference,
	) -> Result<(), CcusageRuntimeError> {
		let registry = self.registry.as_ref().ok_or_else(|| {
			CcusageRuntimeError::InvalidRegistryMetadata(
				"registry client is unavailable".to_string(),
			)
		})?;
		let version = registry.latest_version().await?;
		self.install_version_locked(source, preference, registry, &version)
			.await
	}

	async fn install_version_locked(
		&self,
		source: CcusageRuntimeSource,
		preference: CcusageRuntimePreference,
		registry: &CcusageRegistry,
		version: &Version,
	) -> Result<(), CcusageRuntimeError> {
		if !is_owned_source(source) {
			return Err(CcusageRuntimeError::SourceCannotInstall(source));
		}
		let stage = storage::create_stage(&self.root)?;
		let staged_binary = match source {
			CcusageRuntimeSource::Bun | CcusageRuntimeSource::Npm => {
				let runner = discovery::find_runner(source)
					.ok_or(CcusageRuntimeError::SourceUnavailable(source))?;
				acquisition::acquire_with_package_runner(
					source,
					&runner,
					version,
					stage.path(),
				)
				.await?
			}
			CcusageRuntimeSource::Download => {
				acquisition::acquire_with_download(
					registry,
					version,
					stage.path(),
				)
				.await?
			}
			_ => return Err(CcusageRuntimeError::SourceCannotInstall(source)),
		};
		let staged_version = discovery::probe_version(&staged_binary).await?;
		if staged_version != *version {
			return Err(CcusageRuntimeError::InvalidBinary(format!(
				"installed ccusage version {staged_version} does not match requested {version}"
			)));
		}
		let executable = storage::commit_binary(
			&self.root,
			source,
			version,
			&staged_binary,
		)?;
		discovery::candidate_from_path(source, executable).await?;
		storage::save_preference(&self.root, &preference)?;
		*self
			.preference
			.write()
			.map_err(|_| CcusageRuntimeError::StatePoisoned)? = preference;
		self.clear_configuration_error()?;
		let active = self.resolve_current_preference().await?;
		self.set_active(active)?;
		Ok(())
	}

	async fn install_preferred_locked(
		&self,
		preserved_preference: Option<CcusageRuntimePreference>,
	) -> Result<(), CcusageRuntimeError> {
		let sources = acquisition_sources(
			discovery::find_runner(CcusageRuntimeSource::Bun).is_some(),
			discovery::find_runner(CcusageRuntimeSource::Npm).is_some(),
			registry::platform_package().is_ok(),
		);
		let registry = self.registry.as_ref().ok_or_else(|| {
			CcusageRuntimeError::InvalidRegistryMetadata(
				"registry client is unavailable".to_string(),
			)
		})?;
		let version = registry.latest_version().await?;
		let mut last_error = None;
		for source in sources {
			let preference =
				acquisition_preference(preserved_preference.as_ref(), source)?;
			match self
				.install_version_locked(source, preference, registry, &version)
				.await
			{
				Ok(()) => return Ok(()),
				Err(error) => {
					log::warn!(
						"ccusage installation with {source:?} failed: {error}"
					);
					last_error = Some(error);
				}
			}
		}
		Err(last_error.unwrap_or(CcusageRuntimeError::NoRuntime))
	}

	async fn latest_version(&self) -> Option<Version> {
		let registry = self.registry.as_ref()?;
		match registry.latest_version().await {
			Ok(version) => Some(version),
			Err(error) => {
				log::warn!(
					"failed to check the latest ccusage version: {error}"
				);
				None
			}
		}
	}

	fn active_snapshot(
		&self,
	) -> Result<Option<Arc<CcusageExecutable>>, CcusageRuntimeError> {
		self.active
			.read()
			.map(|active| active.clone())
			.map_err(|_| CcusageRuntimeError::StatePoisoned)
	}

	fn set_active(
		&self,
		candidate: RuntimeCandidate,
	) -> Result<Arc<CcusageExecutable>, CcusageRuntimeError> {
		let active = Arc::new(CcusageExecutable {
			source: candidate.source,
			path: candidate.path,
			version: candidate.version,
		});
		*self
			.active
			.write()
			.map_err(|_| CcusageRuntimeError::StatePoisoned)? = Some(active.clone());
		Ok(active)
	}

	fn clear_active(&self) -> Result<(), CcusageRuntimeError> {
		*self
			.active
			.write()
			.map_err(|_| CcusageRuntimeError::StatePoisoned)? = None;
		Ok(())
	}

	fn clear_configuration_error(&self) -> Result<(), CcusageRuntimeError> {
		*self
			.configuration_error
			.write()
			.map_err(|_| CcusageRuntimeError::StatePoisoned)? = None;
		Ok(())
	}

	fn configuration_error_message(
		&self,
	) -> Result<Option<String>, CcusageRuntimeError> {
		self.configuration_error
			.read()
			.map(|error| error.clone())
			.map_err(|_| CcusageRuntimeError::StatePoisoned)
	}

	async fn candidate_dtos(
		&self,
		active: Option<&CcusageExecutable>,
		acquisition: AcquisitionAvailability,
	) -> Vec<CcusageRuntimeCandidateDto> {
		let sources = [
			CcusageRuntimeSource::Path,
			CcusageRuntimeSource::Bun,
			CcusageRuntimeSource::Npm,
			CcusageRuntimeSource::Download,
			CcusageRuntimeSource::Bundled,
		];
		futures::future::join_all(
			sources
				.into_iter()
				.map(|source| self.candidate_dto(source, active, acquisition)),
		)
		.await
	}

	async fn candidate_dto(
		&self,
		source: CcusageRuntimeSource,
		active: Option<&CcusageExecutable>,
		acquisition: AcquisitionAvailability,
	) -> CcusageRuntimeCandidateDto {
		let active = active.filter(|active| active.source == source);
		let version = if let Some(active) = active {
			Some(active.version.clone())
		} else {
			let candidate = match source {
				CcusageRuntimeSource::Path => match which::which("ccusage") {
					Ok(path) => {
						match discovery::candidate_from_path(source, path).await
						{
							Ok(candidate) => Some(candidate),
							Err(error) => {
								log::warn!("ccusage PATH candidate is unavailable: {error}");
								None
							}
						}
					}
					Err(_) => None,
				},
				CcusageRuntimeSource::Bun
				| CcusageRuntimeSource::Npm
				| CcusageRuntimeSource::Download => {
					match discovery::installed_candidate(&self.root, source)
						.await
					{
						Ok(candidate) => Some(candidate),
						Err(CcusageRuntimeError::SourceNotInstalled(_)) => None,
						Err(error) => {
							log::warn!(
								"ccusage {source:?} installation is unavailable: {error}"
							);
							None
						}
					}
				}
				CcusageRuntimeSource::Bundled => {
					match self.bundled.as_ref().filter(|path| path.is_file()) {
						Some(path) => {
							match discovery::candidate_from_path(
								source,
								path.clone(),
							)
							.await
							{
								Ok(candidate) => Some(candidate),
								Err(error) => {
									log::warn!("bundled ccusage is unavailable: {error}");
									None
								}
							}
						}
						None => None,
					}
				}
				_ => None,
			};
			candidate.map(|candidate| candidate.version)
		};
		let installed = version.is_some();
		CcusageRuntimeCandidateDto {
			source,
			available: installed,
			installed,
			version,
			can_install: acquisition.can_install(source),
			can_update: installed && source_can_update(source, acquisition),
		}
	}

	async fn acquisition_availability(&self) -> AcquisitionAvailability {
		let (bun, npm) = tokio::join!(
			self.package_runner_available(CcusageRuntimeSource::Bun),
			self.package_runner_available(CcusageRuntimeSource::Npm),
		);
		AcquisitionAvailability {
			bun,
			npm,
			download: self.registry.is_some()
				&& registry::platform_package().is_ok(),
		}
	}

	async fn package_runner_available(
		&self,
		source: CcusageRuntimeSource,
	) -> bool {
		let Some(runner) = discovery::find_runner(source) else {
			return false;
		};
		match acquisition::validate_package_runner(source, &runner).await {
			Ok(()) => true,
			Err(error) => {
				log::warn!("ccusage {source:?} runner is unavailable: {error}");
				false
			}
		}
	}

	fn can_update_active(
		&self,
		active: &CcusageExecutable,
		acquisition: AcquisitionAvailability,
	) -> bool {
		source_can_update(active.source, acquisition)
	}
}

async fn with_operation_deadline<T>(
	operation: impl Future<Output = Result<T, CcusageRuntimeError>>,
) -> Result<T, CcusageRuntimeError> {
	with_operation_timeout(RUNTIME_OPERATION_TIMEOUT, operation).await
}

async fn with_operation_timeout<T>(
	timeout: Duration,
	operation: impl Future<Output = Result<T, CcusageRuntimeError>>,
) -> Result<T, CcusageRuntimeError> {
	tokio::time::timeout(timeout, operation)
		.await
		.map_err(|_| CcusageRuntimeError::RuntimeOperationTimedOut)?
}

pub fn select_candidate(
	preference: &CcusageRuntimePreference,
	candidates: &[RuntimeCandidate],
) -> Result<RuntimeCandidate, CcusageRuntimeError> {
	match preference {
		CcusageRuntimePreference::Auto => candidates
			.iter()
			.min_by_key(|candidate| source_priority(candidate.source))
			.cloned()
			.ok_or(CcusageRuntimeError::NoRuntime),
		CcusageRuntimePreference::Manual(path) => candidates
			.iter()
			.find(|candidate| {
				candidate.source == CcusageRuntimeSource::Manual
					&& candidate.path == *path
			})
			.cloned()
			.ok_or(CcusageRuntimeError::SourceUnavailable(
				CcusageRuntimeSource::Manual,
			)),
		preference => {
			let source = preference.source();
			candidates
				.iter()
				.find(|candidate| candidate.source == source)
				.cloned()
				.ok_or(CcusageRuntimeError::SourceUnavailable(source))
		}
	}
}

fn source_priority(source: CcusageRuntimeSource) -> usize {
	match source {
		CcusageRuntimeSource::Environment => 0,
		CcusageRuntimeSource::Path => 1,
		CcusageRuntimeSource::Bun => 2,
		CcusageRuntimeSource::Npm => 3,
		CcusageRuntimeSource::Download => 4,
		CcusageRuntimeSource::Bundled => 5,
		CcusageRuntimeSource::Manual => 6,
		CcusageRuntimeSource::Auto => 7,
	}
}

fn preference_for_source(
	source: CcusageRuntimeSource,
) -> Result<CcusageRuntimePreference, CcusageRuntimeError> {
	match source {
		CcusageRuntimeSource::Bun => Ok(CcusageRuntimePreference::Bun),
		CcusageRuntimeSource::Npm => Ok(CcusageRuntimePreference::Npm),
		CcusageRuntimeSource::Download => {
			Ok(CcusageRuntimePreference::Download)
		}
		_ => Err(CcusageRuntimeError::SourceCannotInstall(source)),
	}
}

fn acquisition_preference(
	preserved: Option<&CcusageRuntimePreference>,
	source: CcusageRuntimeSource,
) -> Result<CcusageRuntimePreference, CcusageRuntimeError> {
	preserved
		.cloned()
		.map(Ok)
		.unwrap_or_else(|| preference_for_source(source))
}

fn auto_install_preference(
	active: Option<CcusageRuntimeSource>,
) -> Option<CcusageRuntimePreference> {
	match active {
		Some(
			CcusageRuntimeSource::Manual
			| CcusageRuntimeSource::Path
			| CcusageRuntimeSource::Bun
			| CcusageRuntimeSource::Npm
			| CcusageRuntimeSource::Download,
		) => None,
		_ => Some(CcusageRuntimePreference::Auto),
	}
}

fn source_can_update(
	source: CcusageRuntimeSource,
	availability: AcquisitionAvailability,
) -> bool {
	match source {
		CcusageRuntimeSource::Bun => availability.bun,
		CcusageRuntimeSource::Npm => availability.npm,
		CcusageRuntimeSource::Download => availability.download,
		CcusageRuntimeSource::Bundled => availability.any(),
		_ => false,
	}
}

fn is_owned_source(source: CcusageRuntimeSource) -> bool {
	matches!(
		source,
		CcusageRuntimeSource::Bun
			| CcusageRuntimeSource::Npm
			| CcusageRuntimeSource::Download
	)
}

fn acquisition_sources(
	has_bun: bool,
	has_npm: bool,
	has_download: bool,
) -> Vec<CcusageRuntimeSource> {
	let mut sources = Vec::new();
	if has_bun {
		sources.push(CcusageRuntimeSource::Bun);
	}
	if has_npm {
		sources.push(CcusageRuntimeSource::Npm);
	}
	if has_download {
		sources.push(CcusageRuntimeSource::Download);
	}
	sources
}

fn executable_dto(
	active: &CcusageExecutable,
	can_update: bool,
) -> CcusageRuntimeExecutableDto {
	CcusageRuntimeExecutableDto {
		source: active.source,
		version: active.version.clone(),
		can_update,
	}
}

fn version_is_older(current: &str, latest: &Version) -> bool {
	current
		.parse::<Version>()
		.map(|current| current < *latest)
		.unwrap_or(false)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn candidate(source: CcusageRuntimeSource, path: &str) -> RuntimeCandidate {
		RuntimeCandidate {
			source,
			path: PathBuf::from(path),
			version: "20.0.1".to_string(),
		}
	}

	#[test]
	fn auto_prefers_path_then_owned_then_bundled() {
		let candidates = vec![
			candidate(CcusageRuntimeSource::Bundled, "/bundle/ccusage"),
			candidate(CcusageRuntimeSource::Download, "/data/ccusage"),
			candidate(CcusageRuntimeSource::Path, "/usr/bin/ccusage"),
		];
		let selected =
			select_candidate(&CcusageRuntimePreference::Auto, &candidates)
				.expect("auto source");
		assert_eq!(selected.source, CcusageRuntimeSource::Path);
	}

	#[test]
	fn explicit_source_failure_does_not_fall_back() {
		let candidates =
			vec![candidate(CcusageRuntimeSource::Bundled, "/bundle/ccusage")];
		let result = select_candidate(
			&CcusageRuntimePreference::Manual(PathBuf::from(
				"/missing/ccusage",
			)),
			&candidates,
		);
		assert!(result.is_err());
	}

	#[test]
	fn client_errors_do_not_expose_executable_paths() {
		let error = CcusageRuntimeError::Spawn {
			path: PathBuf::from("/private/user/ccusage"),
			error: std::io::Error::new(
				std::io::ErrorKind::PermissionDenied,
				"denied",
			),
		};
		let message = error.client_message();
		assert!(!message.contains("/private/user"));
	}

	#[test]
	fn auto_install_prefers_bun_then_npm_then_download() {
		assert_eq!(
			acquisition_sources(true, true, true),
			vec![
				CcusageRuntimeSource::Bun,
				CcusageRuntimeSource::Npm,
				CcusageRuntimeSource::Download,
			]
		);
		assert_eq!(
			acquisition_sources(false, true, true),
			vec![CcusageRuntimeSource::Npm, CcusageRuntimeSource::Download,]
		);
		assert_eq!(
			acquisition_sources(false, false, true),
			vec![CcusageRuntimeSource::Download]
		);
		assert_eq!(
			acquisition_preference(
				Some(&CcusageRuntimePreference::Auto),
				CcusageRuntimeSource::Bun,
			)
			.unwrap(),
			CcusageRuntimePreference::Auto
		);
		assert_eq!(
			auto_install_preference(Some(CcusageRuntimeSource::Path)),
			None
		);
		assert_eq!(
			auto_install_preference(Some(CcusageRuntimeSource::Environment)),
			Some(CcusageRuntimePreference::Auto)
		);
		assert_eq!(
			auto_install_preference(Some(CcusageRuntimeSource::Bundled)),
			Some(CcusageRuntimePreference::Auto)
		);
		for source in [
			CcusageRuntimeSource::Bun,
			CcusageRuntimeSource::Npm,
			CcusageRuntimeSource::Download,
		] {
			assert_eq!(auto_install_preference(Some(source)), None);
			assert_eq!(
				acquisition_preference(None, source).unwrap().source(),
				source
			);
		}
	}

	#[test]
	fn update_capability_tracks_the_required_acquisition_source() {
		let availability = AcquisitionAvailability {
			bun: false,
			npm: true,
			download: true,
		};
		assert!(!source_can_update(CcusageRuntimeSource::Bun, availability));
		assert!(source_can_update(CcusageRuntimeSource::Npm, availability));
		assert!(source_can_update(
			CcusageRuntimeSource::Download,
			availability,
		));
		assert!(source_can_update(
			CcusageRuntimeSource::Bundled,
			availability,
		));
		assert!(!source_can_update(CcusageRuntimeSource::Path, availability));
	}

	#[tokio::test]
	async fn runtime_operation_deadline_cancels_slow_work() {
		let error = with_operation_timeout(Duration::from_millis(10), async {
			tokio::time::sleep(Duration::from_millis(100)).await;
			Ok(())
		})
		.await
		.expect_err("slow runtime operation rejected");

		assert!(matches!(
			error,
			CcusageRuntimeError::RuntimeOperationTimedOut
		));
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn swapping_active_runtime_changes_the_next_snapshot() {
		use std::os::unix::fs::PermissionsExt;

		let root = tempfile::tempdir().unwrap();
		let old_path = root.path().join("old-ccusage");
		let new_path = root.path().join("new-ccusage");
		for path in [&old_path, &new_path] {
			std::fs::write(path, b"#!/bin/sh\nprintf 'ccusage 20.0.1\\n'\n")
				.unwrap();
			std::fs::set_permissions(
				path,
				std::fs::Permissions::from_mode(0o755),
			)
			.unwrap();
		}
		let runtime =
			CcusageRuntime::load(root.path().to_path_buf(), None, None);
		runtime
			.set_active(RuntimeCandidate {
				source: CcusageRuntimeSource::Path,
				path: old_path.clone(),
				version: "20.0.1".to_string(),
			})
			.unwrap();
		let held_by_request = runtime.snapshot().await.unwrap();
		runtime
			.set_active(RuntimeCandidate {
				source: CcusageRuntimeSource::Download,
				path: new_path.clone(),
				version: "20.0.1".to_string(),
			})
			.unwrap();
		let next = runtime.snapshot().await.unwrap();
		assert_eq!(held_by_request.path, old_path);
		assert_eq!(next.path, new_path);
	}

	#[cfg(unix)]
	#[tokio::test]
	async fn status_reprobes_a_cached_external_runtime() {
		use std::os::unix::fs::PermissionsExt;

		let root = tempfile::tempdir().unwrap();
		let executable = root.path().join("ccusage");
		std::fs::write(&executable, b"#!/bin/sh\nprintf 'ccusage 20.0.2\\n'\n")
			.unwrap();
		std::fs::set_permissions(
			&executable,
			std::fs::Permissions::from_mode(0o755),
		)
		.unwrap();
		let mut runtime = CcusageRuntime::load(
			root.path().join("runtime"),
			None,
			Some(CcusageRuntimePreference::Manual(executable.clone())),
		);
		Arc::get_mut(&mut runtime).unwrap().registry = None;
		runtime
			.set_active(RuntimeCandidate {
				source: CcusageRuntimeSource::Path,
				path: executable.clone(),
				version: "20.0.1".to_string(),
			})
			.unwrap();

		let current = runtime.status().await;
		assert!(current.reachable);
		assert_eq!(current.version.as_deref(), Some("20.0.2"));
		assert_eq!(
			runtime.active_snapshot().unwrap().unwrap().version,
			"20.0.2"
		);
		let described = runtime.describe().await.unwrap();
		assert_eq!(
			described
				.active
				.as_ref()
				.map(|active| active.version.as_str()),
			Some("20.0.2")
		);

		std::fs::write(&executable, b"#!/bin/sh\nexit 1\n").unwrap();
		let unavailable = runtime.status().await;
		assert!(!unavailable.reachable);
		assert!(unavailable.version.is_none());
		assert!(runtime.active_snapshot().unwrap().is_none());
		let described = runtime.describe().await.unwrap();
		assert!(described.active.is_none());
		assert!(described.error.is_some());
	}

	#[tokio::test]
	async fn malformed_runtime_config_does_not_fall_back() {
		let root = tempfile::tempdir().unwrap();
		std::fs::write(root.path().join("runtime.json"), b"not json").unwrap();
		let mut runtime =
			CcusageRuntime::load(root.path().to_path_buf(), None, None);
		let error = runtime.snapshot().await.expect_err("config error");
		assert!(matches!(
			error,
			CcusageRuntimeError::InvalidRuntimeConfig(_)
		));
		Arc::get_mut(&mut runtime).unwrap().registry = None;
		let state = runtime
			.select(SetCcusageRuntimeRequest {
				source: CcusageRuntimeSource::Auto,
				path: None,
			})
			.await
			.expect("Auto resets malformed config");
		assert_eq!(state.preference, CcusageRuntimeSource::Auto);
		assert!(state.error.is_some());
		assert_eq!(
			storage::load_preference(root.path()).unwrap(),
			Some(CcusageRuntimePreference::Auto)
		);
	}

	#[tokio::test]
	async fn corrupt_managed_candidate_is_not_reported_as_installed() {
		let root = tempfile::tempdir().unwrap();
		let path = storage::installation_path(
			root.path(),
			CcusageRuntimeSource::Download,
			&Version::new(20, 0, 0),
		)
		.unwrap();
		std::fs::create_dir_all(path.parent().unwrap()).unwrap();
		std::fs::write(path, b"not an executable").unwrap();
		let runtime =
			CcusageRuntime::load(root.path().to_path_buf(), None, None);
		let candidate = runtime
			.candidate_dto(
				CcusageRuntimeSource::Download,
				None,
				AcquisitionAvailability {
					bun: false,
					npm: false,
					download: true,
				},
			)
			.await;
		assert!(!candidate.available);
		assert!(!candidate.installed);
		assert!(candidate.can_install);
	}
}

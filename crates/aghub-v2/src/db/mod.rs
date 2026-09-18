use std::future::Future;
use std::path::{Path, PathBuf};

use anyhow::Context as _;
use gpui_kit::{App, AppContext, AsyncApp, Global, Task};
use sea_orm::sqlx::sqlite::SqliteJournalMode;
use sea_orm::{
	ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbErr,
};
use sea_orm_migration::{MigrationTrait, MigratorTrait, async_trait};

mod m20260918_000001_create_project;
mod m20260918_000002_create_plugin;

const DATABASE_FILE: &str = "aghub.db";

/// SeaORM/SQLx require Tokio. GPUI's executor is not Tokio, so database
/// futures run on this runtime and are awaited as GPUI tasks.
struct GlobalTokio {
	owned_runtime: Option<tokio::runtime::Runtime>,
	handle: tokio::runtime::Handle,
}

impl Global for GlobalTokio {}

impl Drop for GlobalTokio {
	fn drop(&mut self) {
		if let Some(runtime) = self.owned_runtime.take() {
			runtime.shutdown_background();
		}
	}
}

struct AbortOnDrop(tokio::task::AbortHandle);

impl Drop for AbortOnDrop {
	fn drop(&mut self) {
		self.0.abort();
	}
}

pub struct Tokio;

impl Tokio {
	/// Run a Tokio future and return it as a GPUI task.
	///
	/// Dropping the GPUI task aborts the Tokio work. Do not `block_on` Tokio
	/// from the UI thread.
	pub fn spawn<C, Fut, R>(
		cx: &C,
		future: Fut,
	) -> Task<Result<R, tokio::task::JoinError>>
	where
		C: AppContext,
		Fut: Future<Output = R> + Send + 'static,
		R: Send + 'static,
	{
		cx.read_global(|tokio: &GlobalTokio, cx| {
			let join_handle = tokio.handle.spawn(future);
			let abort = AbortOnDrop(join_handle.abort_handle());
			cx.background_spawn(async move {
				let result = join_handle.await;
				drop(abort);
				result
			})
		})
	}
}

pub struct AppDb {
	conn: DatabaseConnection,
}

impl Global for AppDb {}

impl AppDb {
	pub fn new(conn: DatabaseConnection) -> Self {
		Self { conn }
	}

	pub fn conn(&self) -> &DatabaseConnection {
		&self.conn
	}
}

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
	fn migrations() -> Vec<Box<dyn MigrationTrait>> {
		vec![
			Box::new(m20260918_000001_create_project::Migration),
			Box::new(m20260918_000002_create_plugin::Migration),
		]
	}
}

pub fn init(cx: &mut App) {
	let runtime = tokio::runtime::Builder::new_multi_thread()
		.worker_threads(2)
		.enable_all()
		.thread_name("aghub-tokio")
		.build()
		.expect("failed to initialize Tokio");
	let handle = runtime.handle().clone();
	cx.set_global(GlobalTokio {
		owned_runtime: Some(runtime),
		handle,
	});
}

pub fn database_path() -> anyhow::Result<PathBuf> {
	if let Some(path) = std::env::var_os("AGHUB_DATABASE_PATH") {
		return Ok(PathBuf::from(path));
	}
	let dirs = directories::ProjectDirs::from("com", "akrc", "aghub")
		.ok_or_else(|| {
			anyhow::anyhow!("could not resolve app data directory")
		})?;
	Ok(dirs.data_dir().join(DATABASE_FILE))
}

pub async fn open(cx: &AsyncApp) -> anyhow::Result<()> {
	let path = database_path()?;
	let db = AppDb::new(
		Tokio::spawn(cx, {
			let path = path.clone();
			async move { connect_and_setup(&path).await }
		})
		.await
		.context("database task failed")?
		.context("connect database")?,
	);
	let conn = db.conn().clone();
	Tokio::spawn(cx, async move { conn.execute_unprepared("SELECT 1").await })
		.await
		.context("database task failed")?
		.context("ping database")?;
	cx.update(|cx| cx.set_global(db));
	Ok(())
}

pub async fn connect_and_setup(
	path: &Path,
) -> Result<DatabaseConnection, DbErr> {
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent).map_err(|error| {
			DbErr::Custom(format!(
				"create data directory {}: {error}",
				parent.display()
			))
		})?;
	}

	let path = path.to_owned();
	let mut options = ConnectOptions::new("sqlite://aghub.db?mode=rwc");
	options
		.sqlx_logging(false)
		.map_sqlx_sqlite_opts(move |opts| {
			opts.filename(&path)
				.create_if_missing(true)
				.foreign_keys(true)
				.journal_mode(SqliteJournalMode::Wal)
		});

	let db = Database::connect(options).await?;
	Migrator::up(&db, None).await?;
	Ok(db)
}

#[cfg(test)]
mod tests {
	use super::*;
	use sea_orm::ConnectionTrait;

	#[tokio::test]
	async fn connect_and_setup_creates_file_and_is_idempotent() {
		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("Application Support").join("aghub.db");

		let db = AppDb::new(connect_and_setup(&path).await.unwrap());
		assert!(path.exists());
		db.conn().execute_unprepared("SELECT 1").await.unwrap();
		drop(db);

		connect_and_setup(&path).await.unwrap();
	}

	#[tokio::test]
	async fn connect_and_setup_creates_projects_table() {
		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("aghub.db");
		let db = connect_and_setup(&path).await.unwrap();
		db.execute_unprepared("SELECT id, name, path FROM projects LIMIT 0")
			.await
			.unwrap();
	}

	#[tokio::test]
	async fn connect_and_setup_creates_plugins_table() {
		let dir = tempfile::tempdir().unwrap();
		let path = dir.path().join("aghub.db");
		let db = connect_and_setup(&path).await.unwrap();
		db.execute_unprepared(
			"SELECT id, name, description FROM plugins LIMIT 0",
		)
		.await
		.unwrap();
	}
}

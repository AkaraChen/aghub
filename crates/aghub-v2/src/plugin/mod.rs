mod entity;

use sea_orm::{
	ActiveModelTrait, ConnectionTrait, DbErr, EntityTrait, QueryOrder, Set,
};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plugin {
	pub id: String,
	pub name: String,
	pub description: String,
}

#[derive(Debug, Clone)]
pub struct InstallPlugin {
	pub id: String,
	pub name: String,
	pub description: String,
}

#[derive(Debug, Error)]
pub enum Error {
	#[error("plugin id must not be empty")]
	EmptyId,
	#[error("plugin name must not be empty")]
	EmptyName,
	#[error("plugin not found: {0}")]
	NotFound(String),
	#[error(transparent)]
	Database(#[from] DbErr),
}

pub async fn install(
	db: &impl ConnectionTrait,
	input: InstallPlugin,
) -> Result<Plugin, Error> {
	let id = require_id(input.id)?;
	let name = require_name(input.name)?;
	if let Some(existing) =
		entity::Entity::find_by_id(id.clone()).one(db).await?
	{
		return Ok(plugin_from_model(existing));
	}
	let model = entity::ActiveModel {
		id: Set(id),
		name: Set(name),
		description: Set(input.description),
	}
	.insert(db)
	.await?;
	Ok(plugin_from_model(model))
}

pub async fn get(db: &impl ConnectionTrait, id: &str) -> Result<Plugin, Error> {
	let id = require_id(id.to_string())?;
	let model = entity::Entity::find_by_id(id.clone())
		.one(db)
		.await?
		.ok_or(Error::NotFound(id))?;
	Ok(plugin_from_model(model))
}

pub async fn list(db: &impl ConnectionTrait) -> Result<Vec<Plugin>, Error> {
	Ok(entity::Entity::find()
		.order_by_asc(entity::Column::Name)
		.order_by_asc(entity::Column::Id)
		.all(db)
		.await?
		.into_iter()
		.map(plugin_from_model)
		.collect())
}

fn require_id(id: String) -> Result<String, Error> {
	let id = id.trim().to_string();
	if id.is_empty() {
		return Err(Error::EmptyId);
	}
	Ok(id)
}

fn require_name(name: String) -> Result<String, Error> {
	let name = name.trim().to_string();
	if name.is_empty() {
		return Err(Error::EmptyName);
	}
	Ok(name)
}

fn plugin_from_model(model: entity::Model) -> Plugin {
	Plugin {
		id: model.id,
		name: model.name,
		description: model.description,
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::db::connect_and_setup;

	async fn setup() -> (tempfile::TempDir, sea_orm::DatabaseConnection) {
		let dir = tempfile::tempdir().unwrap();
		let db = connect_and_setup(&dir.path().join("aghub.db"))
			.await
			.unwrap();
		(dir, db)
	}

	fn install_input(id: &str, name: &str, description: &str) -> InstallPlugin {
		InstallPlugin {
			id: id.to_string(),
			name: name.to_string(),
			description: description.to_string(),
		}
	}

	#[tokio::test]
	async fn install_is_idempotent_and_lists_by_name() {
		let (_dir, db) = setup().await;
		let first = install(&db, install_input(" zeta ", " Zeta ", " second "))
			.await
			.unwrap();
		assert_eq!(first.id, "zeta");
		assert_eq!(first.name, "Zeta");
		assert_eq!(first.description, " second ");

		let again = install(&db, install_input("zeta", "ignored", "nope"))
			.await
			.unwrap();
		assert_eq!(again, first);

		let alpha = install(&db, install_input("alpha", "Alpha", "a"))
			.await
			.unwrap();
		let listed = list(&db).await.unwrap();
		assert_eq!(
			listed
				.iter()
				.map(|plugin| plugin.id.as_str())
				.collect::<Vec<_>>(),
			["alpha", "zeta"]
		);
		assert_eq!(get(&db, "alpha").await.unwrap(), alpha);
	}

	#[tokio::test]
	async fn install_rejects_blank_id_and_name() {
		let (_dir, db) = setup().await;
		assert!(matches!(
			install(&db, install_input("  ", "Name", "d"))
				.await
				.unwrap_err(),
			Error::EmptyId
		));
		assert!(matches!(
			install(&db, install_input("id", "  ", "d"))
				.await
				.unwrap_err(),
			Error::EmptyName
		));
	}

	#[tokio::test]
	async fn missing_plugin_is_not_found() {
		let (_dir, db) = setup().await;
		assert!(matches!(
			get(&db, "missing").await.unwrap_err(),
			Error::NotFound(id) if id == "missing"
		));
	}
}

mod entity;

use std::fmt;
use std::str::FromStr;

use sea_orm::{
	ActiveModelTrait, ConnectionTrait, DbErr, EntityTrait, QueryOrder, Set,
};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ProjectId(Uuid);

impl ProjectId {
	pub fn generate() -> Self {
		Self(Uuid::new_v4())
	}

	fn to_db(self) -> String {
		self.0.to_string()
	}
}

impl fmt::Display for ProjectId {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		self.0.fmt(f)
	}
}

impl FromStr for ProjectId {
	type Err = uuid::Error;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		Ok(Self(Uuid::parse_str(s)?))
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Scope {
	Global,
	Project(ProjectId),
}

impl Scope {
	pub fn resolve(self, projects: &[Project]) -> Self {
		match self {
			Self::Global => Self::Global,
			Self::Project(id)
				if projects.iter().any(|project| project.id == id) =>
			{
				self
			}
			Self::Project(_) => Self::Global,
		}
	}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
	pub id: ProjectId,
	pub name: String,
	pub path: String,
}

#[derive(Debug, Clone)]
pub struct CreateProject {
	pub name: String,
	pub path: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateProject {
	pub name: Option<String>,
	pub path: Option<String>,
}

#[derive(Debug, Error)]
pub enum Error {
	#[error("project name must not be empty")]
	EmptyName,
	#[error("project path must not be empty")]
	EmptyPath,
	#[error("project not found: {0}")]
	NotFound(ProjectId),
	#[error("invalid project id")]
	InvalidId(#[from] uuid::Error),
	#[error(transparent)]
	Database(#[from] DbErr),
}

pub async fn create(
	db: &impl ConnectionTrait,
	input: CreateProject,
) -> Result<Project, Error> {
	let name = require_name(input.name)?;
	let path = require_path(input.path)?;
	let id = ProjectId::generate();
	let model = entity::ActiveModel {
		id: Set(id.to_db()),
		name: Set(name),
		path: Set(path),
	}
	.insert(db)
	.await?;
	project_from_model(model)
}

pub async fn get(
	db: &impl ConnectionTrait,
	id: ProjectId,
) -> Result<Project, Error> {
	let model = entity::Entity::find_by_id(id.to_db())
		.one(db)
		.await?
		.ok_or(Error::NotFound(id))?;
	project_from_model(model)
}

pub async fn list(db: &impl ConnectionTrait) -> Result<Vec<Project>, Error> {
	entity::Entity::find()
		.order_by_asc(entity::Column::Name)
		.order_by_asc(entity::Column::Id)
		.all(db)
		.await?
		.into_iter()
		.map(project_from_model)
		.collect()
}

pub async fn update(
	db: &impl ConnectionTrait,
	id: ProjectId,
	input: UpdateProject,
) -> Result<Project, Error> {
	let model = entity::Entity::find_by_id(id.to_db())
		.one(db)
		.await?
		.ok_or(Error::NotFound(id))?;
	let name = input.name.map(require_name).transpose()?;
	let path = input.path.map(require_path).transpose()?;
	if name.is_none() && path.is_none() {
		return project_from_model(model);
	}
	let mut active: entity::ActiveModel = model.into();
	if let Some(name) = name {
		active.name = Set(name);
	}
	if let Some(path) = path {
		active.path = Set(path);
	}
	project_from_model(active.update(db).await?)
}

pub async fn delete(
	db: &impl ConnectionTrait,
	id: ProjectId,
) -> Result<(), Error> {
	let result = entity::Entity::delete_by_id(id.to_db()).exec(db).await?;
	if result.rows_affected == 0 {
		return Err(Error::NotFound(id));
	}
	Ok(())
}

fn require_name(name: String) -> Result<String, Error> {
	let name = name.trim().to_string();
	if name.is_empty() {
		return Err(Error::EmptyName);
	}
	Ok(name)
}

fn require_path(path: String) -> Result<String, Error> {
	let path = path.trim().to_string();
	if path.is_empty() {
		return Err(Error::EmptyPath);
	}
	Ok(path)
}

fn project_from_model(model: entity::Model) -> Result<Project, Error> {
	Ok(Project {
		id: model.id.parse()?,
		name: model.name,
		path: model.path,
	})
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

	fn create_input(name: &str, path: &str) -> CreateProject {
		CreateProject {
			name: name.to_string(),
			path: path.to_string(),
		}
	}

	#[tokio::test]
	async fn create_get_list_update_delete() {
		let (_dir, db) = setup().await;

		let created = create(&db, create_input(" zeta ", " /tmp/zeta "))
			.await
			.unwrap();
		assert_eq!(created.name, "zeta");
		assert_eq!(created.path, "/tmp/zeta");

		let fetched = get(&db, created.id).await.unwrap();
		assert_eq!(fetched, created);
		assert_eq!(
			update(&db, created.id, UpdateProject::default())
				.await
				.unwrap(),
			created
		);

		let alpha = create(&db, create_input("alpha", "/tmp/alpha"))
			.await
			.unwrap();
		let listed = list(&db).await.unwrap();
		assert_eq!(
			listed
				.iter()
				.map(|project| project.name.as_str())
				.collect::<Vec<_>>(),
			["alpha", "zeta"]
		);

		let renamed = update(
			&db,
			created.id,
			UpdateProject {
				name: Some(" beta ".to_string()),
				path: Some("/tmp/beta".to_string()),
			},
		)
		.await
		.unwrap();
		assert_eq!(renamed.name, "beta");
		assert_eq!(renamed.path, "/tmp/beta");
		assert_eq!(get(&db, created.id).await.unwrap(), renamed);

		delete(&db, created.id).await.unwrap();
		assert!(matches!(
			get(&db, created.id).await.unwrap_err(),
			Error::NotFound(id) if id == created.id
		));
		assert_eq!(list(&db).await.unwrap(), vec![alpha]);
	}

	#[tokio::test]
	async fn create_rejects_blank_name_and_path() {
		let (_dir, db) = setup().await;
		assert!(matches!(
			create(&db, create_input("   ", "/tmp/x"))
				.await
				.unwrap_err(),
			Error::EmptyName
		));
		assert!(matches!(
			create(&db, create_input("x", " \t ")).await.unwrap_err(),
			Error::EmptyPath
		));
	}

	#[tokio::test]
	async fn missing_project_is_not_found() {
		let (_dir, db) = setup().await;
		let id = ProjectId::generate();
		assert!(
			matches!(get(&db, id).await.unwrap_err(), Error::NotFound(got) if got == id)
		);
		assert!(matches!(
			update(&db, id, UpdateProject { name: Some("n".into()), path: None })
				.await
				.unwrap_err(),
			Error::NotFound(got) if got == id
		));
		assert!(matches!(
			delete(&db, id).await.unwrap_err(),
			Error::NotFound(got) if got == id
		));
	}

	#[tokio::test]
	async fn update_rejects_blank_fields() {
		let (_dir, db) = setup().await;
		let project = create(&db, create_input("keep", "/tmp/keep"))
			.await
			.unwrap();
		assert!(matches!(
			update(
				&db,
				project.id,
				UpdateProject {
					name: Some(" ".into()),
					path: None
				}
			)
			.await
			.unwrap_err(),
			Error::EmptyName
		));
		assert!(matches!(
			update(
				&db,
				project.id,
				UpdateProject {
					name: None,
					path: Some("".into())
				}
			)
			.await
			.unwrap_err(),
			Error::EmptyPath
		));
		assert_eq!(get(&db, project.id).await.unwrap(), project);
	}

	#[test]
	fn resolve_keeps_global_and_known_projects() {
		let keep = Project {
			id: ProjectId::generate(),
			name: "keep".into(),
			path: "/tmp/keep".into(),
		};
		let gone = ProjectId::generate();
		assert_eq!(
			Scope::Global.resolve(std::slice::from_ref(&keep)),
			Scope::Global
		);
		assert_eq!(
			Scope::Project(keep.id).resolve(std::slice::from_ref(&keep)),
			Scope::Project(keep.id)
		);
		assert_eq!(Scope::Project(gone).resolve(&[keep]), Scope::Global);
		assert_eq!(Scope::Project(gone).resolve(&[]), Scope::Global);
	}
}

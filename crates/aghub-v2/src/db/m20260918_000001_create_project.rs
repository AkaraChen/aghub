use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.create_table(
				Table::create()
					.table(Projects::Table)
					.if_not_exists()
					.col(string(Projects::Id).primary_key().take())
					.col(string(Projects::Name))
					.col(string(Projects::Path))
					.to_owned(),
			)
			.await
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.drop_table(Table::drop().table(Projects::Table).to_owned())
			.await
	}
}

#[derive(DeriveIden)]
enum Projects {
	Table,
	Id,
	Name,
	Path,
}

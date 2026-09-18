use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.create_table(
				Table::create()
					.table(Plugins::Table)
					.if_not_exists()
					.col(string(Plugins::Id).primary_key().take())
					.col(string(Plugins::Name))
					.col(string(Plugins::Description))
					.to_owned(),
			)
			.await
	}

	async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.drop_table(Table::drop().table(Plugins::Table).to_owned())
			.await
	}
}

#[derive(DeriveIden)]
enum Plugins {
	Table,
	Id,
	Name,
	Description,
}

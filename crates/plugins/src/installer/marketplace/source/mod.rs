mod manifest;
mod repository;
mod resolution;

pub(super) use self::manifest::{
	manifest_from_marketplace_plugin, materialize_marketplace_plugin,
};
pub(super) use self::repository::{
	github_owner_repo, is_marketplace_source, load_marketplace_repository_urls,
	local_source_remote_fallback, marketplace_path_for,
};
pub(super) use self::resolution::resolve_marketplace_source;

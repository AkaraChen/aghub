use aghub_core::{
	models::ResourceScope, skills::source::discover_skill_source,
};
use rocket::{http::Status, serde::json::Json, State};

use crate::{
	auth::ApiAuth,
	codex_skills::CodexSkillReadRoots,
	dto::{
		skill::SkillContentQuery, skill_source::SkillRepositorySourceResponse,
	},
	error::{ApiError, ApiResult},
	extractors::ScopeParams,
	routes::resolved_to_resource_scope,
};

use super::{
	canonical_existing, canonical_skill_read_roots, ensure_skill_tree_allowed,
	expand_tilde_path, get_skill_root, known_skill_paths,
};

#[get("/skills/source?<query..>")]
pub async fn get_skill_source(
	_auth: ApiAuth,
	providers: &State<CodexSkillReadRoots>,
	query: SkillContentQuery,
) -> ApiResult<Option<SkillRepositorySourceResponse>> {
	let providers = providers.inner().clone();
	let source = tokio::task::spawn_blocking(move || {
		let resolved = ScopeParams {
			scope: query.scope,
			project_root: query.project_root,
		}
		.resolve()?;
		let (scope, project) = resolved_to_resource_scope(&resolved);
		let roots =
			canonical_skill_read_roots(scope, project.as_deref(), &providers)?;
		let known = known_skill_paths(scope, project.as_deref());
		let directory = canonical_existing(&get_skill_root(
			expand_tilde_path(&query.path),
		))?;
		ensure_skill_tree_allowed(&directory, &roots, &known)?;
		let parsed = skill::parse_skill_dir(&directory).map_err(|error| {
			ApiError::new(
				Status::BadRequest,
				error.to_string(),
				"SKILL_PARSE_FAILED",
			)
		})?;
		let lock = match scope {
			ResourceScope::GlobalOnly => {
				skill::get_skill_from_lock(&parsed.name)
			}
			ResourceScope::ProjectOnly => {
				let lock = skill::read_local_lock(project.as_deref());
				lock.skills.get(&parsed.name).map(|entry| {
					let mut source = skill::SkillLockEntry::new(
						entry.source.clone(),
						entry.source_type.clone(),
						entry.source.clone(),
						entry.ref_name.clone(),
						None,
						String::new(),
						None,
					);
					source.extra = entry.extra.clone();
					source
				})
			}
			// A name-only lock cannot identify an installation across both scopes.
			ResourceScope::Both => None,
		};
		discover_skill_source(&directory, lock.as_ref())
			.map(|source| source.map(Into::into))
			.map_err(|error| {
				ApiError::new(
					Status::BadRequest,
					error.to_string(),
					"SKILL_SOURCE_INVALID",
				)
			})
	})
	.await
	.map_err(|_| {
		ApiError::new(
			Status::InternalServerError,
			"Skill source inspection failed",
			"SKILL_SOURCE_INSPECTION_FAILED",
		)
	})??;
	Ok(Json(source))
}

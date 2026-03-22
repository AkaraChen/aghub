use aghub_core::{errors::ConfigError, models::Skill, registry};
use rocket::http::Status;
use rocket::response::status::NoContent;
use rocket::serde::json::Json;

use crate::{
    dto::skill::{CreateSkillRequest, SkillResponse, UpdateSkillRequest},
    error::{ApiCreated, ApiError, ApiNoContent, ApiResult},
    extractors::{AgentParam, ScopeParams},
    routes::{build_manager_from_resolved, require_writable_scope},
};

fn check_skills_supported(agent: &AgentParam) -> Result<(), ApiError> {
    let descriptor = registry::get(agent.0);
    if !descriptor.capabilities.skills {
        return Err(ApiError::new(
            Status::UnprocessableEntity,
            format!("Agent '{}' does not support skills", descriptor.id),
            "UNSUPPORTED_OPERATION",
        ));
    }
    Ok(())
}

fn check_skills_mutable(agent: &AgentParam) -> Result<(), ApiError> {
    check_skills_supported(agent)?;
    let descriptor = registry::get(agent.0);
    // Agents with filesystem-discovered skills cannot be mutated via JSON
    if descriptor.global_skills_path.is_some() {
        let skills_path = descriptor
            .global_skills_path
            .map(|f| f().to_string_lossy().to_string())
            .unwrap_or_else(|| "~/.config/agents/skills".to_string());
        return Err(ApiError::new(
            Status::UnprocessableEntity,
            format!(
                "Agent '{}' manages skills via the filesystem ({}). \
                 Create/update/delete skills by managing files in that directory.",
                descriptor.id, skills_path
            ),
            "UNSUPPORTED_OPERATION",
        ));
    }
    Ok(())
}

#[get("/agents/<agent>/skills?<scope..>")]
pub fn list_skills(agent: AgentParam, scope: ScopeParams) -> ApiResult<Vec<SkillResponse>> {
    check_skills_supported(&agent)?;
    let resolved = scope.resolve()?;
    let mut manager = build_manager_from_resolved(&agent, &resolved)?;

    if resolved.is_all() {
        let (skills, _) = manager.load_both_annotated().map_err(ApiError::from)?;
        let items = skills
            .iter()
            .map(|(s, src)| {
                let mut r = SkillResponse::from(s);
                r.source = Some(*src);
                r
            })
            .collect();
        return Ok(Json(items));
    }

    let config = manager.load().map_err(ApiError::from)?;
    let skills = config.skills.iter().map(SkillResponse::from).collect();
    Ok(Json(skills))
}

#[post("/agents/<agent>/skills?<scope..>", data = "<body>")]
pub fn create_skill(
    agent: AgentParam,
    scope: ScopeParams,
    body: Json<CreateSkillRequest>,
) -> ApiCreated<SkillResponse> {
    check_skills_mutable(&agent)?;
    let resolved = scope.resolve()?;
    require_writable_scope(&resolved)?;
    let mut manager = build_manager_from_resolved(&agent, &resolved)?;
    match manager.load() {
        Ok(_) => {}
        Err(ConfigError::NotFound { .. }) => manager.init_empty_config(),
        Err(e) => return Err(ApiError::from(e)),
    }
    let skill = Skill::from(body.into_inner());
    let response = SkillResponse::from(&skill);
    manager.add_skill(skill).map_err(ApiError::from)?;
    Ok((Status::Created, Json(response)))
}

#[get("/agents/<agent>/skills/<name>?<scope..>")]
pub fn get_skill(agent: AgentParam, name: &str, scope: ScopeParams) -> ApiResult<SkillResponse> {
    check_skills_supported(&agent)?;
    let resolved = scope.resolve()?;
    let mut manager = build_manager_from_resolved(&agent, &resolved)?;

    if resolved.is_all() {
        let (skills, _) = manager.load_both_annotated().map_err(ApiError::from)?;
        let skill = skills
            .iter()
            .find(|(s, _)| s.name == name)
            .ok_or_else(|| ApiError::from(ConfigError::resource_not_found("skill", name)))?;
        let mut r = SkillResponse::from(&skill.0);
        r.source = Some(skill.1);
        return Ok(Json(r));
    }

    manager.load().map_err(ApiError::from)?;
    let skill = manager
        .get_skill(name)
        .ok_or_else(|| ApiError::from(ConfigError::resource_not_found("skill", name)))?;
    Ok(Json(SkillResponse::from(skill)))
}

#[put("/agents/<agent>/skills/<name>?<scope..>", data = "<body>")]
pub fn update_skill(
    agent: AgentParam,
    name: &str,
    scope: ScopeParams,
    body: Json<UpdateSkillRequest>,
) -> ApiResult<SkillResponse> {
    check_skills_mutable(&agent)?;
    let resolved = scope.resolve()?;
    require_writable_scope(&resolved)?;
    let mut manager = build_manager_from_resolved(&agent, &resolved)?;
    manager.load().map_err(ApiError::from)?;
    let existing = manager
        .get_skill(name)
        .ok_or_else(|| ApiError::from(ConfigError::resource_not_found("skill", name)))?
        .clone();
    let updated = body.into_inner().apply_to(existing);
    let response = SkillResponse::from(&updated);
    manager.update_skill(name, updated).map_err(ApiError::from)?;
    Ok(Json(response))
}

#[delete("/agents/<agent>/skills/<name>?<scope..>")]
pub fn delete_skill(agent: AgentParam, name: &str, scope: ScopeParams) -> ApiNoContent {
    check_skills_mutable(&agent)?;
    let resolved = scope.resolve()?;
    require_writable_scope(&resolved)?;
    let mut manager = build_manager_from_resolved(&agent, &resolved)?;
    manager.load().map_err(ApiError::from)?;
    manager.remove_skill(name).map_err(ApiError::from)?;
    Ok(NoContent)
}

#[post("/agents/<agent>/skills/<name>/enable?<scope..>")]
pub fn enable_skill(
    agent: AgentParam,
    name: &str,
    scope: ScopeParams,
) -> ApiResult<SkillResponse> {
    check_skills_supported(&agent)?;
    let resolved = scope.resolve()?;
    require_writable_scope(&resolved)?;
    let mut manager = build_manager_from_resolved(&agent, &resolved)?;
    manager.load().map_err(ApiError::from)?;
    manager.enable_skill(name).map_err(ApiError::from)?;
    let skill = manager.get_skill(name).expect("skill present after enable");
    Ok(Json(SkillResponse::from(skill)))
}

#[post("/agents/<agent>/skills/<name>/disable?<scope..>")]
pub fn disable_skill(
    agent: AgentParam,
    name: &str,
    scope: ScopeParams,
) -> ApiResult<SkillResponse> {
    check_skills_supported(&agent)?;
    let resolved = scope.resolve()?;
    require_writable_scope(&resolved)?;
    let mut manager = build_manager_from_resolved(&agent, &resolved)?;
    manager.load().map_err(ApiError::from)?;
    manager.disable_skill(name).map_err(ApiError::from)?;
    let skill = manager.get_skill(name).expect("skill present after disable");
    Ok(Json(SkillResponse::from(skill)))
}

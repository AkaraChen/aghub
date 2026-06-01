use std::process::Command;

use rocket::serde::json::Json;

use crate::dto::integrations::{
	CodeEditorType, OpenWithEditorRequest, ToolInfoDto, ToolPreferencesDto,
};

fn resolve_editor_path(path: &str) -> std::path::PathBuf {
	let Some(home) = dirs::home_dir() else {
		return path.into();
	};

	if let Some(stripped) = path.strip_prefix("~/") {
		return home.join(stripped);
	}

	if let Some(stripped) = path.strip_prefix("/~/") {
		return home.join(stripped);
	}

	path.into()
}

#[get("/integrations/code-editors")]
pub fn list_code_editors() -> Json<Vec<ToolInfoDto>> {
	let editors: Vec<ToolInfoDto> = CodeEditorType::all()
		.iter()
		.map(ToolInfoDto::from)
		.collect();
	Json(editors)
}

#[post("/integrations/open-with-editor", format = "json", data = "<request>")]
pub async fn open_with_editor(
	request: Json<OpenWithEditorRequest>,
) -> Result<(), String> {
	let req = request.into_inner();
	let path = resolve_editor_path(&req.path);

	let mut cmd = Command::new(req.editor.cli_command());
	cmd.arg(&path);
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		cmd.creation_flags(crate::CREATE_NO_WINDOW);
	}
	match cmd.spawn() {
		Ok(_) => Ok(()),
		Err(e) => Err(format!("Failed to open editor: {e}")),
	}
}

#[get("/integrations/preferences")]
pub fn get_preferences() -> Json<ToolPreferencesDto> {
	Json(ToolPreferencesDto::default())
}

#[cfg(test)]
mod tests {
	use super::resolve_editor_path;

	#[test]
	fn resolve_editor_path_expands_tilde_prefix() {
		let Some(home) = dirs::home_dir() else {
			return;
		};

		assert_eq!(
			resolve_editor_path("~/skills/demo/SKILL.md"),
			home.join("skills/demo/SKILL.md")
		);
	}

	#[test]
	fn resolve_editor_path_expands_slash_tilde_prefix() {
		let Some(home) = dirs::home_dir() else {
			return;
		};

		assert_eq!(
			resolve_editor_path("/~/.agents/demo/SKILL.md"),
			home.join(".agents/demo/SKILL.md")
		);
	}
}

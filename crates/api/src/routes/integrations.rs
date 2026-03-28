use std::process::Command;

use rocket::serde::json::Json;

use crate::dto::integrations::{
	CodeEditorType, OpenWithEditorRequest, ToolInfoDto, ToolPreferencesDto,
};

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

	match Command::new(req.editor.cli_command())
		.arg(&req.path)
		.spawn()
	{
		Ok(_) => Ok(()),
		Err(e) => Err(format!("Failed to open editor: {}", e)),
	}
}

#[get("/integrations/preferences")]
pub fn get_preferences() -> Json<ToolPreferencesDto> {
	Json(ToolPreferencesDto::default())
}

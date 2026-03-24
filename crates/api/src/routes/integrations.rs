use std::process::Command;

use rocket::serde::json::Json;

use crate::dto::integrations::{
	CodeEditorType, OpenInTerminalRequest, OpenWithEditorRequest, TerminalType,
	ToolInfoDto, ToolTypeDto,
};

fn is_command_available(command: &str) -> bool {
	Command::new("which")
		.arg(command)
		.output()
		.map(|output| output.status.success())
		.unwrap_or(false)
}

fn get_code_editor_info(editor: &CodeEditorType) -> ToolInfoDto {
	let installed = is_command_available(editor.cli_command());

	let path = if installed {
		Some(format!("$(which {})", editor.cli_command()))
	} else {
		None
	};

	ToolInfoDto {
		id: serde_json::to_string(editor)
			.unwrap_or_default()
			.trim_matches('"')
			.to_string(),
		name: editor.display_name().to_string(),
		installed,
		path,
		tool_type: ToolTypeDto::CodeEditor,
	}
}

fn get_terminal_info(terminal: &TerminalType) -> ToolInfoDto {
	let installed = terminal
		.cli_command()
		.map_or(false, |cmd| is_command_available(cmd));

	let path = if installed {
		terminal
			.cli_command()
			.map(|cmd| format!("$(which {})", cmd))
	} else {
		None
	};

	ToolInfoDto {
		id: serde_json::to_string(terminal)
			.unwrap_or_default()
			.trim_matches('"')
			.to_string(),
		name: terminal.display_name().to_string(),
		installed,
		path,
		tool_type: ToolTypeDto::Terminal,
	}
}

#[get("/integrations/code-editors")]
pub fn list_code_editors() -> Json<Vec<ToolInfoDto>> {
	let editors: Vec<ToolInfoDto> = CodeEditorType::all()
		.iter()
		.map(get_code_editor_info)
		.collect();
	Json(editors)
}

#[get("/integrations/terminals")]
pub fn list_terminals() -> Json<Vec<ToolInfoDto>> {
	let terminals: Vec<ToolInfoDto> = TerminalType::all()
		.iter()
		.map(get_terminal_info)
		.collect();
	Json(terminals)
}

#[post("/integrations/open-with-editor", format = "json", data = "<request>")]
pub async fn open_with_editor(
	request: Json<OpenWithEditorRequest>,
) -> Result<(), String> {
	let req = request.into_inner();

	if req.editor.requires_terminal() {
		return Err("Terminal-based editors are temporarily unsupported".to_string());
	}

	match Command::new(req.editor.cli_command()).arg(&req.path).spawn() {
		Ok(_) => Ok(()),
		Err(e) => Err(format!("Failed to open editor: {}", e)),
	}
}

#[post("/integrations/open-in-terminal", format = "json", data = "<_request>")]
pub async fn open_in_terminal_endpoint(
	_request: Json<OpenInTerminalRequest>,
) -> Result<(), String> {
	Ok(())
}



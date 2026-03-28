use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodeEditorType {
	VsCode,
	VsCodeInsiders,
	Cursor,
	Windsurf,
	Zed,
	AntiGravity,
	Trae,
	SublimeText,
	WebStorm,
	IntellijIdea,
	GoLand,
	RustRover,
	Fleet,
	Nova,
	VsCodium,
}

pub struct EditorDescriptor {
	pub display_name: &'static str,
	pub cli_command: &'static str,
	pub macos_app_names: &'static [&'static str],
	pub windows_exe_paths: &'static [&'static str],
	pub linux_bin_paths: &'static [&'static str],
	pub linux_flatpak_ids: &'static [&'static str],
}

impl CodeEditorType {
	pub fn descriptor(&self) -> EditorDescriptor {
		match self {
			Self::VsCode => EditorDescriptor {
				display_name: "VS Code",
				cli_command: "code",
				macos_app_names: &["Visual Studio Code.app"],
				windows_exe_paths: &[
					"%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe",
					"%ProgramFiles%\\Microsoft VS Code\\Code.exe",
				],
				linux_bin_paths: &[
					"/usr/bin/code",
					"/usr/share/code/bin/code",
					"/snap/bin/code",
				],
				linux_flatpak_ids: &["com.visualstudio.code"],
			},
			Self::VsCodeInsiders => EditorDescriptor {
				display_name: "VS Code Insiders",
				cli_command: "code-insiders",
				macos_app_names: &["Visual Studio Code - Insiders.app"],
				windows_exe_paths: &[
					"%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe",
					"%ProgramFiles%\\Microsoft VS Code Insiders\\Code - Insiders.exe",
				],
				linux_bin_paths: &[
					"/usr/bin/code-insiders",
					"/snap/bin/code-insiders",
				],
				linux_flatpak_ids: &["com.visualstudio.code.insiders"],
			},
			Self::Cursor => EditorDescriptor {
				display_name: "Cursor",
				cli_command: "cursor",
				macos_app_names: &["Cursor.app"],
				windows_exe_paths: &[
					"%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe",
					"%LOCALAPPDATA%\\cursor\\Cursor.exe",
				],
				linux_bin_paths: &[
					"/usr/bin/cursor",
					"/opt/Cursor/cursor",
				],
				linux_flatpak_ids: &[],
			},
			Self::Windsurf => EditorDescriptor {
				display_name: "Windsurf",
				cli_command: "windsurf",
				macos_app_names: &["Windsurf.app"],
				windows_exe_paths: &[
					"%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe",
				],
				linux_bin_paths: &[
					"/usr/bin/windsurf",
					"/opt/Windsurf/windsurf",
				],
				linux_flatpak_ids: &[],
			},
			Self::Zed => EditorDescriptor {
				display_name: "Zed",
				cli_command: "zed",
				macos_app_names: &["Zed.app"],
				windows_exe_paths: &[
					"%LOCALAPPDATA%\\Zed\\zed.exe",
				],
				linux_bin_paths: &[
					"/usr/bin/zed",
					"/usr/local/bin/zed",
				],
				linux_flatpak_ids: &["dev.zed.Zed"],
			},
			Self::AntiGravity => EditorDescriptor {
				display_name: "AntiGravity",
				cli_command: "antigravity",
				macos_app_names: &["Antigravity.app"],
				windows_exe_paths: &[],
				linux_bin_paths: &[],
				linux_flatpak_ids: &[],
			},
			Self::Trae => EditorDescriptor {
				display_name: "Trae",
				cli_command: "trae",
				macos_app_names: &["Trae.app"],
				windows_exe_paths: &[
					"%LOCALAPPDATA%\\Programs\\Trae\\Trae.exe",
				],
				linux_bin_paths: &["/usr/bin/trae"],
				linux_flatpak_ids: &[],
			},
			Self::SublimeText => EditorDescriptor {
				display_name: "Sublime Text",
				cli_command: "subl",
				macos_app_names: &["Sublime Text.app"],
				windows_exe_paths: &[
					"%ProgramFiles%\\Sublime Text\\subl.exe",
					"%ProgramFiles%\\Sublime Text 3\\subl.exe",
				],
				linux_bin_paths: &[
					"/usr/bin/subl",
					"/opt/sublime_text/sublime_text",
					"/snap/bin/subl",
				],
				linux_flatpak_ids: &["com.sublimetext.three"],
			},
			Self::WebStorm => EditorDescriptor {
				display_name: "WebStorm",
				cli_command: "webstorm",
				macos_app_names: &["WebStorm.app"],
				windows_exe_paths: &[
					"%ProgramFiles%\\JetBrains\\WebStorm\\bin\\webstorm64.exe",
					"%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\webstorm.cmd",
				],
				linux_bin_paths: &[
					"/usr/bin/webstorm",
					"/usr/local/bin/webstorm",
					"/snap/bin/webstorm",
				],
				linux_flatpak_ids: &["com.jetbrains.WebStorm"],
			},
			Self::IntellijIdea => EditorDescriptor {
				display_name: "IntelliJ IDEA",
				cli_command: "idea",
				macos_app_names: &[
					"IntelliJ IDEA.app",
					"IntelliJ IDEA CE.app",
				],
				windows_exe_paths: &[
					"%ProgramFiles%\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe",
					"%ProgramFiles%\\JetBrains\\IntelliJ IDEA Community Edition\\bin\\idea64.exe",
					"%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\idea.cmd",
				],
				linux_bin_paths: &[
					"/usr/bin/idea",
					"/usr/local/bin/idea",
					"/snap/bin/intellij-idea-ultimate",
					"/snap/bin/intellij-idea-community",
				],
				linux_flatpak_ids: &[
					"com.jetbrains.IntelliJ-IDEA-Ultimate",
					"com.jetbrains.IntelliJ-IDEA-Community",
				],
			},
			Self::GoLand => EditorDescriptor {
				display_name: "GoLand",
				cli_command: "goland",
				macos_app_names: &["GoLand.app"],
				windows_exe_paths: &[
					"%ProgramFiles%\\JetBrains\\GoLand\\bin\\goland64.exe",
					"%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\goland.cmd",
				],
				linux_bin_paths: &[
					"/usr/bin/goland",
					"/usr/local/bin/goland",
					"/snap/bin/goland",
				],
				linux_flatpak_ids: &["com.jetbrains.GoLand"],
			},
			Self::RustRover => EditorDescriptor {
				display_name: "RustRover",
				cli_command: "rustrover",
				macos_app_names: &["RustRover.app"],
				windows_exe_paths: &[
					"%ProgramFiles%\\JetBrains\\RustRover\\bin\\rustrover64.exe",
					"%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\rustrover.cmd",
				],
				linux_bin_paths: &[
					"/usr/bin/rustrover",
					"/usr/local/bin/rustrover",
					"/snap/bin/rustrover",
				],
				linux_flatpak_ids: &["com.jetbrains.RustRover"],
			},
			Self::Fleet => EditorDescriptor {
				display_name: "Fleet",
				cli_command: "fleet",
				macos_app_names: &["Fleet.app"],
				windows_exe_paths: &[
					"%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\fleet.cmd",
				],
				linux_bin_paths: &[
					"/usr/bin/fleet",
					"/usr/local/bin/fleet",
				],
				linux_flatpak_ids: &[],
			},
			Self::Nova => EditorDescriptor {
				display_name: "Nova",
				cli_command: "nova",
				macos_app_names: &["Nova.app"],
				windows_exe_paths: &[],
				linux_bin_paths: &[],
				linux_flatpak_ids: &[],
			},
			Self::VsCodium => EditorDescriptor {
				display_name: "VSCodium",
				cli_command: "codium",
				macos_app_names: &["VSCodium.app"],
				windows_exe_paths: &[
					"%LOCALAPPDATA%\\Programs\\VSCodium\\VSCodium.exe",
					"%ProgramFiles%\\VSCodium\\VSCodium.exe",
				],
				linux_bin_paths: &[
					"/usr/bin/codium",
					"/snap/bin/codium",
				],
				linux_flatpak_ids: &["com.vscodium.codium"],
			},
		}
	}

	pub fn display_name(&self) -> &'static str {
		self.descriptor().display_name
	}

	pub fn cli_command(&self) -> &'static str {
		self.descriptor().cli_command
	}

	pub fn all() -> &'static [CodeEditorType] {
		&[
			Self::VsCode,
			Self::VsCodeInsiders,
			Self::Cursor,
			Self::Windsurf,
			Self::Zed,
			Self::AntiGravity,
			Self::Trae,
			Self::SublimeText,
			Self::WebStorm,
			Self::IntellijIdea,
			Self::GoLand,
			Self::RustRover,
			Self::Fleet,
			Self::Nova,
			Self::VsCodium,
		]
	}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfoDto {
	pub id: String,
	pub name: String,
	pub installed: bool,
	pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolPreferencesDto {
	pub code_editor: Option<CodeEditorType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWithEditorRequest {
	pub path: String,
	pub editor: CodeEditorType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenSkillFolderRequest {
	pub skill_path: String,
	pub editor: Option<CodeEditorType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditSkillFolderRequest {
	pub skill_path: String,
}

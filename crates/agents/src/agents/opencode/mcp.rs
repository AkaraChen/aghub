use crate::descriptor::*;
use std::path::{Path, PathBuf};

pub(super) fn global_path() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".config/opencode/opencode.json"))
}

pub(super) fn project_path(root: &Path) -> Option<PathBuf> {
	Some(root.join(".opencode/settings.json"))
}

pub(super) fn load(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
	load_scoped_mcps(
		project_root,
		scope,
		Some(global_path),
		Some(project_path),
		mcp_strategy::PARSE_JSON_OPCODE,
	)
}

pub(super) fn save(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
	mcps: &[crate::McpServer],
) -> crate::Result<()> {
	save_scoped_mcps(
		project_root,
		scope,
		mcps,
		Some(global_path),
		Some(project_path),
		mcp_strategy::SERIALIZE_JSON_OPCODE,
	)
}

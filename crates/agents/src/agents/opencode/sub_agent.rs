use crate::descriptor::home_dir;
use crate::sub_agents::{load_scoped_sub_agents, save_scoped_sub_agents};
use std::path::{Path, PathBuf};

fn global_dir() -> Option<PathBuf> {
	home_dir().map(|home| home.join(".config/opencode/agents"))
}

fn project_dir(root: &Path) -> Option<PathBuf> {
	Some(root.join(".opencode/agents"))
}

pub(super) fn load(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::SubAgent>> {
	load_scoped_sub_agents(
		project_root,
		scope,
		Some(global_dir),
		Some(project_dir),
	)
}

pub(super) fn save(
	project_root: Option<&Path>,
	scope: crate::ResourceScope,
	agents: &[crate::SubAgent],
) -> crate::Result<()> {
	save_scoped_sub_agents(
		project_root,
		scope,
		agents,
		Some(global_dir),
		Some(project_dir),
	)
}

use crate::descriptor::*;
use std::path::{Path, PathBuf};

fn mcp_global_path() -> Option<PathBuf> {
home_dir().map(|home| home.join(".claude.json"))
}
fn mcp_project_path(root: &Path) -> Option<PathBuf> {
Some(root.join(".mcp.json"))
}
fn global_data_dir() -> Option<PathBuf> {
home_dir().map(|home| home.join(".claude"))
}
fn load_mcps(
project_root: Option<&Path>,
scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::McpServer>> {
load_scoped_mcps(
project_root,
scope,
Some(mcp_global_path),
Some(mcp_project_path),
mcp_strategy::parse_json_map_mcp_servers,
)
}
fn save_mcps(
project_root: Option<&Path>,
scope: crate::ResourceScope,
mcps: &[crate::McpServer],
) -> crate::Result<()> {
save_scoped_mcps(
project_root,
scope,
mcps,
Some(mcp_global_path),
Some(mcp_project_path),
mcp_strategy::serialize_json_map_mcp_servers,
)
}
fn global_skills_paths() -> Vec<PathBuf> {
let Some(home) = home_dir() else {
return Vec::new();
};
let mut paths = vec![home.join(".claude/skills")];

let marketplaces = home.join(".claude/plugins/marketplaces");
if marketplaces.is_dir() {
collect_skills_dirs(&marketplaces, &mut paths);
}

paths
}

fn collect_skills_dirs(dir: &Path, paths: &mut Vec<PathBuf>) {
if let Ok(entries) = std::fs::read_dir(dir) {
for entry in entries.filter_map(|e| e.ok()) {
let path = entry.path();
if path.is_dir() {
if path.file_name() == Some(std::ffi::OsStr::new("skills")) {
paths.push(path);
} else {
collect_skills_dirs(&path, paths);
}
}
}
}
}

fn project_skills_paths(root: &Path) -> Vec<PathBuf> {
vec![root.join(".claude/skills")]
}

fn global_skill_write_path() -> Option<PathBuf> {
home_dir().map(|home| home.join(".claude/skills"))
}

fn project_skill_write_path(root: &Path) -> Option<PathBuf> {
Some(root.join(".claude/skills"))
}

fn sub_agent_global_dir() -> Option<PathBuf> {
home_dir().map(|home| home.join(".claude/agents"))
}

fn sub_agent_project_dir(root: &Path) -> Option<PathBuf> {
Some(root.join(".claude/agents"))
}

fn load_sub_agents(
project_root: Option<&Path>,
scope: crate::ResourceScope,
) -> crate::Result<Vec<crate::SubAgent>> {
load_scoped_sub_agents(
project_root,
scope,
Some(sub_agent_global_dir),
Some(sub_agent_project_dir),
)
}

fn save_sub_agents(
project_root: Option<&Path>,
scope: crate::ResourceScope,
agents: &[crate::SubAgent],
) -> crate::Result<()> {
save_scoped_sub_agents(
project_root,
scope,
agents,
Some(sub_agent_global_dir),
Some(sub_agent_project_dir),
)
}

pub const DESCRIPTOR: AgentDescriptor = AgentDescriptor {
id: "claude",
display_name: "Claude Code",
mcp_parse_config: Some(mcp_strategy::parse_json_map_mcp_servers),
mcp_serialize_config: Some(mcp_strategy::serialize_json_map_mcp_servers),
load_mcps,
save_mcps,
mcp_global_path: Some(mcp_global_path),
mcp_project_path: Some(mcp_project_path),
global_data_dir,
capabilities: Capabilities {
skills: SkillCapabilities {
scopes: ScopeSupport {
global: true,
project: true,
},
universal: false,
},
mcp: McpCapabilities {
scopes: ScopeSupport {
global: true,
project: true,
},
stdio: true,
remote: true,
enable_disable: false,
},
sub_agents: SubAgentCapabilities {
scopes: ScopeSupport {
global: true,
project: true,
},
},
},
global_skill_paths: Some(GlobalSkillPaths {
read: global_skills_paths,
write: global_skill_write_path,
}),
project_skill_paths: Some(ProjectSkillPaths {
read: project_skills_paths,
write: project_skill_write_path,
}),
load_sub_agents,
save_sub_agents,
cli_name: "claude",
validate_args: &["--version"],
project_markers: &[".claude", ".mcp.json"],
skills_cli_name: Some("claude-code"),
};

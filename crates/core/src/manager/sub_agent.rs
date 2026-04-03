use crate::{
errors::{ConfigError, Result},
models::SubAgent,
};
use log::info;

use super::ConfigManager;

impl ConfigManager {
/// List all loaded sub-agents.
pub fn list_sub_agents(&self) -> Vec<&SubAgent> {
self.config
.as_ref()
.map(|c| c.sub_agents.iter().collect())
.unwrap_or_default()
}

/// Get a single sub-agent by name.
pub fn get_sub_agent(&self, name: &str) -> Option<&SubAgent> {
self.config
.as_ref()
.and_then(|c| c.sub_agents.iter().find(|a| a.name == name))
}

/// Add a new sub-agent and persist via the adapter.
pub fn add_sub_agent(&mut self, agent: SubAgent) -> Result<()> {
{
let config = self.config_mut()?;
if config.sub_agents.iter().any(|a| a.name == agent.name) {
return Err(ConfigError::resource_exists(
"sub_agent",
&agent.name,
));
}
config.sub_agents.push(agent);
}
info!(
"added sub-agent, saving for agent '{}' in scope {:?}",
self.adapter.name(),
self.write_scope
);
self.save_sub_agents_current()
}

/// Patch an existing sub-agent by name and persist via the adapter.
///
/// Only the fields present in `patch` are overwritten; omitted fields keep
/// their current value (true PATCH semantics — the config file is **not**
/// re-scanned before the write).
pub fn update_sub_agent(
&mut self,
name: &str,
patch: SubAgentPatch,
) -> Result<()> {
// If the name changes we need to remove the old file first.
let old_source_path = self
.config
.as_ref()
.and_then(|c| c.sub_agents.iter().find(|a| a.name == name))
.and_then(|a| a.source_path.clone());
let name_changed = patch
.name
.as_deref()
.map(|n| n != name)
.unwrap_or(false);

{
let config = self.config_mut()?;
let agent = config
.sub_agents
.iter_mut()
.find(|a| a.name == name)
.ok_or_else(|| {
ConfigError::resource_not_found("sub_agent", name)
})?;
patch.apply_to(agent);
}

info!(
"updated sub-agent '{}', saving for agent '{}' in scope {:?}",
name,
self.adapter.name(),
self.write_scope
);
self.save_sub_agents_current()?;

// Remove stale file when the name changed (a new file was written
// under the new name by save_sub_agents_current).
if name_changed {
if let Some(old_path) = old_source_path {
let _ = std::fs::remove_file(old_path);
}
}

Ok(())
}

/// Remove a sub-agent by name and persist via the adapter.
pub fn remove_sub_agent(&mut self, name: &str) -> Result<()> {
// Capture the source path before mutating so we can delete the file.
let source_path = self
.config
.as_ref()
.and_then(|c| c.sub_agents.iter().find(|a| a.name == name))
.and_then(|a| a.source_path.clone());

{
let config = self.config_mut()?;
let before = config.sub_agents.len();
config.sub_agents.retain(|a| a.name != name);
if config.sub_agents.len() == before {
return Err(ConfigError::resource_not_found(
"sub_agent", name,
));
}
}

info!(
"removed sub-agent '{}', saving for agent '{}' in scope {:?}",
name,
self.adapter.name(),
self.write_scope
);
self.save_sub_agents_current()?;

// Delete the backing file (for directory-based storage like Claude).
if let Some(path) = source_path {
let _ = std::fs::remove_file(path);
}

Ok(())
}
}

/// Patch DTO used by `update_sub_agent` — all fields are optional so only
/// the provided ones are overwritten.
#[derive(Debug, Default)]
pub struct SubAgentPatch {
pub name: Option<String>,
pub description: Option<String>,
pub instruction: Option<String>,
}

impl SubAgentPatch {
fn apply_to(self, agent: &mut SubAgent) {
if let Some(name) = self.name {
agent.name = name;
}
if let Some(desc) = self.description {
agent.description = Some(desc);
}
if let Some(instr) = self.instruction {
agent.instruction = Some(instr);
}
}
}

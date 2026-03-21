use crate::ResourceType;
use aghub_core::{
	adapters::create_adapter,
	manager::ConfigManager,
	models::{AgentType, McpServer, McpTransport, Skill},
	paths::find_project_root,
	registry,
};
use anyhow::{bail, Result};
use colored::*;
use inquire::{Confirm, MultiSelect, Select, Text};
use std::collections::HashMap;
use std::path::PathBuf;

/// Current interactive context (agent type and scope)
struct InteractiveContext {
	agent_type: AgentType,
	is_global: bool,
	project_root: Option<PathBuf>,
}

impl InteractiveContext {
	fn agent_name(&self) -> &'static str {
		self.agent_type.as_str()
	}

	fn scope_name(&self) -> String {
		if self.is_global {
			"global".to_string()
		} else {
			"project".to_string()
		}
	}

	fn create_manager(&self) -> ConfigManager {
		let adapter = create_adapter(self.agent_type);
		if self.is_global {
			ConfigManager::new(adapter, true, None)
		} else if let Some(ref root) = self.project_root {
			ConfigManager::new(adapter, false, Some(root))
		} else {
			ConfigManager::new(adapter, true, None)
		}
	}
}

/// Run the interactive CLI wizard
pub fn run_interactive(manager: &mut ConfigManager) -> Result<()> {
	// Detect initial context from the provided manager
	let current_path = manager.config_path().to_path_buf();
	// Collect all project markers from registry
	let all_markers: Vec<&'static str> = registry::iter_all()
		.flat_map(|d| d.project_markers.iter().copied())
		.collect();
	let is_global = !current_path.ancestors().any(|p| {
		p.file_name()
			.is_some_and(|n| all_markers.iter().any(|m| n == *m))
	});

	let agent_type = AgentType::ALL
		.iter()
		.find(|t| t.as_str() == manager.agent_name())
		.copied()
		.unwrap_or(AgentType::Claude);

	let project_root = if is_global {
		find_project_root(&std::env::current_dir()?)
	} else {
		Some(current_path.parent().unwrap_or(&current_path).to_path_buf())
	};

	let mut ctx = InteractiveContext {
		agent_type,
		is_global,
		project_root,
	};

	// Recreate manager with proper context
	*manager = ctx.create_manager();

	// Try to load existing config, or initialize empty if not found
	if manager.load().is_err() {
		manager.init_empty_config();
	}

	loop {
		print_header(&ctx);

		let choices = vec![
			"List resources",
			"Add resource",
			"Update resource",
			"Delete resource",
			"Enable/Disable resource",
			"View resource details",
			"",
			"Switch Agent (Tab)",
			"Switch Scope (<-/->)",
			"",
			"Save & Exit",
		];

		let choice = Select::new(
			&format!(
				"What would you like to do? [{} | {}]",
				ctx.agent_name().cyan(),
				ctx.scope_name().cyan()
			),
			choices,
		)
		.prompt()?;

		match choice {
			"List resources" => list_resources(manager)?,
			"Add resource" => add_resource(manager)?,
			"Update resource" => update_resource(manager)?,
			"Delete resource" => delete_resource(manager)?,
			"Enable/Disable resource" => toggle_resource(manager)?,
			"View resource details" => describe_resource(manager)?,
			"Switch Agent (Tab)" => {
				switch_agent(&mut ctx, manager)?;
				continue;
			}
			"Switch Scope (<-/->)" => {
				switch_scope(&mut ctx, manager)?;
				continue;
			}
			"Save & Exit" => {
				println!("\n{}", "Goodbye!".green().bold());
				break;
			}
			_ => {}
		}

		println!();
	}

	Ok(())
}

fn print_header(_ctx: &InteractiveContext) {
	println!();
}

fn switch_agent(
	ctx: &mut InteractiveContext,
	manager: &mut ConfigManager,
) -> Result<()> {
	ctx.agent_type = ctx.agent_type.next();

	*manager = ctx.create_manager();
	if manager.load().is_err() {
		manager.init_empty_config();
	}

	println!("\n[Switched to {}]\n", ctx.agent_name().yellow().bold());
	Ok(())
}

fn switch_scope(
	ctx: &mut InteractiveContext,
	manager: &mut ConfigManager,
) -> Result<()> {
	if ctx.is_global {
		// Switch to project scope
		if ctx.project_root.is_some() {
			ctx.is_global = false;
		} else {
			// Try to detect project root
			if let Some(root) = find_project_root(&std::env::current_dir()?) {
				ctx.project_root = Some(root);
				ctx.is_global = false;
			} else {
				println!(
					"\n[!] No project root found. Staying in global scope.\n"
				);
				return Ok(());
			}
		}
	} else {
		// Switch to global scope
		ctx.is_global = true;
	}

	*manager = ctx.create_manager();
	if manager.load().is_err() {
		manager.init_empty_config();
	}

	println!(
		"\n[Switched to {} scope]\n",
		ctx.scope_name().yellow().bold()
	);
	Ok(())
}

fn select_resource_type() -> Result<ResourceType> {
	let options = [
		("Skill", ResourceType::Skills),
		("MCP Server", ResourceType::Mcps),
	];

	let selected = Select::new(
		"Select resource type:",
		options.iter().map(|(name, _)| *name).collect(),
	)
	.prompt()?;

	Ok(options
		.iter()
		.find(|(name, _)| *name == selected)
		.unwrap()
		.1)
}

fn list_resources(manager: &ConfigManager) -> Result<()> {
	let config = match manager.config() {
		Some(c) => c,
		None => {
			println!("{}", "No configuration loaded.".yellow());
			return Ok(());
		}
	};

	println!("\n{}", "═══ Resources ═══".bold());

	// Skills
	if !config.skills.is_empty() {
		println!("\n{}", "Skills:".bold());
		for skill in &config.skills {
			let status = if skill.enabled {
				"●".green()
			} else {
				"●".red()
			};
			println!("  {} {}", status, skill.name);
			if let Some(desc) = &skill.description {
				println!("     {}", desc.dimmed());
			}
		}
	}

	// MCPs
	if !config.mcps.is_empty() {
		println!("\n{}", "MCP Servers:".bold());
		for mcp in &config.mcps {
			let status = if mcp.enabled {
				"●".green()
			} else {
				"●".red()
			};
			let transport_type = match &mcp.transport {
				McpTransport::Stdio { .. } => "stdio",
				McpTransport::Sse { .. } => "sse",
				McpTransport::StreamableHttp { .. } => "http",
			};
			println!("  {} {} ({})", status, mcp.name, transport_type.dimmed());
		}
	}

	if config.skills.is_empty() && config.mcps.is_empty() {
		println!("{}", "No resources configured yet.".dimmed());
	}

	Ok(())
}

fn add_resource(manager: &mut ConfigManager) -> Result<()> {
	let resource_type = select_resource_type()?;

	match resource_type {
		ResourceType::Skills => add_skill(manager)?,
		ResourceType::Mcps => add_mcp(manager)?,
	}

	Ok(())
}

fn add_skill(manager: &mut ConfigManager) -> Result<()> {
	println!("\n{}", "═══ Add Skill ═══".bold().cyan());

	let import_method = Select::new(
		"How would you like to add the skill?",
		vec![
			"Search from skills.sh",
			"Import from file/directory",
			"Create manually",
		],
	)
	.prompt()?;

	match import_method {
		"Search from skills.sh" => add_skill_from_registry(manager)?,
		"Import from file/directory" => add_skill_from_path(manager)?,
		"Create manually" => add_skill_manually(manager)?,
		_ => {}
	}

	Ok(())
}

struct RegistrySearchProvider {
	client: skills_sh::Client,
}

impl crate::ui::search::SearchProvider for RegistrySearchProvider {
	type Item = skills_sh::SearchResult;

	fn search(&self, query: &str) -> Vec<Self::Item> {
		let rt = tokio::runtime::Builder::new_current_thread()
			.enable_all()
			.build()
			.ok();
		match rt {
			Some(rt) => {
				rt.block_on(self.client.find(query)).unwrap_or_default()
			}
			None => vec![],
		}
	}

	fn format_item(&self, item: &Self::Item, is_selected: bool) -> String {
		let installs = if item.installs >= 1000 {
			format!("{}k", item.installs / 1000)
		} else {
			item.installs.to_string()
		};

		if is_selected {
			format!(
                "\x1b[36m>\x1b[0m \x1b[36m{}\x1b[0m \x1b[90m({installs} installs) — {}\x1b[0m",
                item.name, item.source
            )
		} else {
			format!(
				"  {} \x1b[90m({installs} installs) — {}\x1b[0m",
				item.name, item.source
			)
		}
	}
}

fn add_skill_from_registry(manager: &mut ConfigManager) -> Result<()> {
	let client = skills_sh::ClientBuilder::new()
		.timeout(std::time::Duration::from_secs(5))
		.build()
		.map_err(|e| anyhow::anyhow!("Failed to create API client: {}", e))?;

	let provider = RegistrySearchProvider { client };

	let rt = std::sync::Arc::new(
		tokio::runtime::Builder::new_multi_thread()
			.enable_all()
			.build()?,
	);
	let search_ui = crate::ui::search::RealtimeSearch::new(
		"Search skills.sh",
		provider,
		rt,
	);
	let skill_result = match search_ui.prompt()? {
		Some(r) => r,
		None => {
			println!("{}", "Cancelled.".dimmed());
			return Ok(());
		}
	};

	println!(
		"\n{} {} ({})",
		"Selected:".bold(),
		skill_result.name.cyan(),
		skill_result.slug.dimmed()
	);

	// Register skill from registry metadata
	let skill = Skill {
		name: skill_result.slug.clone(),
		enabled: true,
		description: Some(skill_result.name.clone()),
		author: Some(skill_result.source.clone()),
		version: None,
		tools: Vec::new(),
		metadata: None,
	};

	manager.add_skill(skill.clone())?;
	println!(
		"\n{} Skill added: {}",
		"[OK]".green().bold(),
		skill_result.slug.cyan()
	);
	println!("{}", serde_json::to_string_pretty(&skill)?);
	Ok(())
}

fn add_skill_from_path(manager: &mut ConfigManager) -> Result<()> {
	let path =
		Text::new("Enter path to skill (directory, .skill file, or SKILL.md):")
			.prompt()?;

	let path = std::path::PathBuf::from(path);
	if !path.exists() {
		println!("{} Path does not exist.", "[X]".red());
		return Ok(());
	}

	match manager.add_skill_from_path(&path) {
		Ok(skill) => {
			println!("\n{} Skill added successfully!", "[OK]".green());
			println!("{}", serde_json::to_string_pretty(&skill)?);
		}
		Err(e) => {
			println!("{} Failed to add skill: {}", "[X]".red(), e);
		}
	}

	Ok(())
}

fn add_skill_manually(manager: &mut ConfigManager) -> Result<()> {
	let name = Text::new("Skill name:")
		.with_help_message("e.g., my-custom-skill")
		.prompt()?;

	let description = Text::new("Description (optional):")
		.with_help_message("What does this skill do?")
		.prompt()?;
	let description = if description.is_empty() {
		None
	} else {
		Some(description)
	};

	let author = Text::new("Author (optional):").prompt()?;
	let author = if author.is_empty() {
		None
	} else {
		Some(author)
	};

	let version = Text::new("Version (optional):")
		.with_help_message("e.g., 1.0.0")
		.prompt()?;
	let version = if version.is_empty() {
		None
	} else {
		Some(version)
	};

	let tools_input = Text::new("Tools (optional, comma-separated):")
		.with_help_message("e.g., tool1, tool2, tool3")
		.prompt()?;
	let tools: Vec<String> = tools_input
		.split(',')
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
		.collect();

	let skill = Skill {
		name,
		enabled: true,
		description,
		author,
		version,
		tools,
		metadata: None,
	};

	manager.add_skill(skill.clone())?;
	println!("\n{} Skill added successfully!", "[OK]".green());
	println!("{}", serde_json::to_string_pretty(&skill)?);

	Ok(())
}

fn add_mcp(manager: &mut ConfigManager) -> Result<()> {
	println!("\n{}", "═══ Add MCP Server ═══".bold().cyan());

	let name = Text::new("MCP server name:")
		.with_help_message("e.g., filesystem, github, fetch")
		.prompt()?;

	let transport_type = Select::new(
		"Transport type:",
		vec![
			"stdio (command)",
			"streamable-http (URL)",
			"sse (URL, legacy)",
		],
	)
	.prompt()?;

	let transport = if transport_type.starts_with("stdio") {
		let command = Text::new("Command:")
			.with_help_message(
				"e.g., npx -y @modelcontextprotocol/server-filesystem /path",
			)
			.prompt()?;

		let parts: Vec<String> =
			command.split_whitespace().map(String::from).collect();
		if parts.is_empty() {
			bail!("Command cannot be empty");
		}

		let cmd = parts[0].clone();
		let args = parts.into_iter().skip(1).collect();

		// Optional env vars
		let add_env = Confirm::new("Add environment variables?")
			.with_default(false)
			.prompt()?;

		let env = if add_env {
			let mut env_map = HashMap::new();
			loop {
				let key = Text::new(
					"Environment variable name (or press Enter to finish):",
				)
				.prompt()?;
				if key.is_empty() {
					break;
				}
				let value =
					Text::new(&format!("Value for {}:", key)).prompt()?;
				env_map.insert(key, value);
			}
			if env_map.is_empty() {
				None
			} else {
				Some(env_map)
			}
		} else {
			None
		};

		McpTransport::Stdio {
			command: cmd,
			args,
			env,
			timeout: None,
		}
	} else {
		let url = Text::new("URL:")
			.with_help_message("e.g., http://localhost:3000")
			.prompt()?;

		// Optional headers
		let add_headers = Confirm::new("Add HTTP headers?")
			.with_default(false)
			.prompt()?;

		let headers = if add_headers {
			let mut headers_map = HashMap::new();
			loop {
				let header = Text::new(
					"Header (format: Key: Value, or press Enter to finish):",
				)
				.prompt()?;
				if header.is_empty() {
					break;
				}
				let parts: Vec<_> = header.splitn(2, ':').collect();
				if parts.len() == 2 {
					headers_map.insert(
						parts[0].trim().to_string(),
						parts[1].trim().to_string(),
					);
				}
			}
			if headers_map.is_empty() {
				None
			} else {
				Some(headers_map)
			}
		} else {
			None
		};

		if transport_type.starts_with("streamable") {
			McpTransport::StreamableHttp {
				url,
				headers,
				timeout: None,
			}
		} else {
			McpTransport::Sse {
				url,
				headers,
				timeout: None,
			}
		}
	};

	let mcp = McpServer::new(name, transport);
	manager.add_mcp(mcp.clone())?;

	println!("\n[OK] MCP server added successfully!");
	println!("{}", serde_json::to_string_pretty(&mcp)?);

	Ok(())
}

fn select_existing_resource(
	manager: &ConfigManager,
	resource_type: ResourceType,
	action: &str,
) -> Result<Option<String>> {
	let config = match manager.config() {
		Some(c) => c,
		None => {
			println!("{}", "No configuration loaded.".yellow());
			return Ok(None);
		}
	};

	let items: Vec<String> = match resource_type {
		ResourceType::Skills => {
			config.skills.iter().map(|s| s.name.clone()).collect()
		}
		ResourceType::Mcps => {
			config.mcps.iter().map(|m| m.name.clone()).collect()
		}
	};

	if items.is_empty() {
		println!(
			"{}",
			format!("No {:?} configured yet.", resource_type).yellow()
		);
		return Ok(None);
	}

	let selected =
		Select::new(&format!("Select resource to {}", action), items)
			.prompt()?;

	Ok(Some(selected))
}

fn update_resource(manager: &mut ConfigManager) -> Result<()> {
	let resource_type = select_resource_type()?;

	let name = match select_existing_resource(manager, resource_type, "update")?
	{
		Some(n) => n,
		None => return Ok(()),
	};

	match resource_type {
		ResourceType::Skills => update_skill(manager, &name)?,
		ResourceType::Mcps => update_mcp(manager, &name)?,
	}

	Ok(())
}

fn update_skill(manager: &mut ConfigManager, name: &str) -> Result<()> {
	println!(
		"\n{}",
		format!("═══ Update Skill: {} ═══", name).bold().cyan()
	);

	let existing = manager
		.get_skill(name)
		.ok_or_else(|| anyhow::anyhow!("Skill not found"))?
		.clone();

	let mut skill = existing.clone();

	// Select fields to update
	let options = vec!["Description", "Author", "Version", "Tools"];

	let selected =
		MultiSelect::new("Select fields to update:", options).prompt()?;

	for field in selected {
		match field {
			"Description" => {
				let current = skill.description.as_deref().unwrap_or("");
				let value =
					Text::new("Description:").with_default(current).prompt()?;
				skill.description =
					if value.is_empty() { None } else { Some(value) };
			}
			"Author" => {
				let current = skill.author.as_deref().unwrap_or("");
				let value =
					Text::new("Author:").with_default(current).prompt()?;
				skill.author =
					if value.is_empty() { None } else { Some(value) };
			}
			"Version" => {
				let current = skill.version.as_deref().unwrap_or("");
				let value =
					Text::new("Version:").with_default(current).prompt()?;
				skill.version =
					if value.is_empty() { None } else { Some(value) };
			}
			"Tools" => {
				let current = skill.tools.join(", ");
				let value = Text::new("Tools (comma-separated):")
					.with_default(&current)
					.prompt()?;
				skill.tools = value
					.split(',')
					.map(|s| s.trim().to_string())
					.filter(|s| !s.is_empty())
					.collect();
			}
			_ => {}
		}
	}

	manager.update_skill(name, skill.clone())?;
	println!("\n[OK] Skill updated successfully!");
	println!("{}", serde_json::to_string_pretty(&skill)?);

	Ok(())
}

fn update_mcp(manager: &mut ConfigManager, name: &str) -> Result<()> {
	println!(
		"\n{}",
		format!("═══ Update MCP: {} ═══", name).bold().cyan()
	);

	let existing = manager
		.get_mcp(name)
		.ok_or_else(|| anyhow::anyhow!("MCP not found"))?
		.clone();

	println!(
		"Current transport: {}",
		format!("{:?}", existing.transport).dimmed()
	);

	let update_transport = Confirm::new("Update transport configuration?")
		.with_default(false)
		.prompt()?;

	let mut mcp = existing.clone();

	if update_transport {
		// Re-use add_mcp logic for transport
		let transport_type = Select::new(
			"New transport type:",
			vec![
				"stdio (command)",
				"streamable-http (URL)",
				"sse (URL, legacy)",
			],
		)
		.prompt()?;

		mcp.transport = if transport_type.starts_with("stdio") {
			let command = Text::new("Command:").prompt()?;
			let parts: Vec<String> =
				command.split_whitespace().map(String::from).collect();
			if parts.is_empty() {
				bail!("Command cannot be empty");
			}
			let cmd = parts[0].clone();
			let args = parts.into_iter().skip(1).collect();
			McpTransport::Stdio {
				command: cmd,
				args,
				env: None,
				timeout: None,
			}
		} else {
			let url = Text::new("URL:").prompt()?;
			if transport_type.starts_with("streamable") {
				McpTransport::StreamableHttp {
					url,
					headers: None,
					timeout: None,
				}
			} else {
				McpTransport::Sse {
					url,
					headers: None,
					timeout: None,
				}
			}
		};
	}

	manager.update_mcp(name, mcp.clone())?;
	println!("\n[OK] MCP server updated successfully!");
	println!("{}", serde_json::to_string_pretty(&mcp)?);

	Ok(())
}

fn delete_resource(manager: &mut ConfigManager) -> Result<()> {
	let resource_type = select_resource_type()?;

	let name = match select_existing_resource(manager, resource_type, "delete")?
	{
		Some(n) => n,
		None => return Ok(()),
	};

	let confirm = Confirm::new(&format!(
		"Are you sure you want to delete '{}' permanently?",
		name
	))
	.with_default(false)
	.prompt()?;

	if !confirm {
		println!("{}", "Cancelled.".dimmed());
		return Ok(());
	}

	match resource_type {
		ResourceType::Skills => manager.remove_skill(&name)?,
		ResourceType::Mcps => manager.remove_mcp(&name)?,
	}

	println!("[OK] '{}' has been deleted.", name);

	Ok(())
}

fn toggle_resource(manager: &mut ConfigManager) -> Result<()> {
	let resource_type = select_resource_type()?;

	let name = match select_existing_resource(manager, resource_type, "toggle")?
	{
		Some(n) => n,
		None => return Ok(()),
	};

	// Check current state
	let (is_enabled, can_toggle) = match resource_type {
		ResourceType::Skills => {
			let skill = manager.get_skill(&name).unwrap();
			(skill.enabled, true)
		}
		ResourceType::Mcps => {
			let mcp = manager.get_mcp(&name).unwrap();
			let adapter = create_adapter(
				AgentType::ALL
					.iter()
					.find(|t| t.as_str() == manager.agent_name())
					.copied()
					.unwrap_or(AgentType::Claude),
			);
			(mcp.enabled, adapter.supports_mcp_enable_disable())
		}
	};

	if !can_toggle {
		println!(
			"[X] This agent doesn't support enabling/disabling MCP servers."
		);
		return Ok(());
	}

	let action = if is_enabled { "disable" } else { "enable" };
	let confirm = Confirm::new(&format!("{} '{}'?", action, name))
		.with_default(true)
		.prompt()?;

	if !confirm {
		println!("{}", "Cancelled.".dimmed());
		return Ok(());
	}

	match resource_type {
		ResourceType::Skills => {
			if is_enabled {
				manager.disable_skill(&name)?
			} else {
				manager.enable_skill(&name)?
			}
		}
		ResourceType::Mcps => {
			if is_enabled {
				manager.disable_mcp(&name)?
			} else {
				manager.enable_mcp(&name)?
			}
		}
	}

	println!(
		"[OK] '{}' is now {}.",
		name,
		if is_enabled { "disabled" } else { "enabled" }
	);

	Ok(())
}

fn describe_resource(manager: &ConfigManager) -> Result<()> {
	let resource_type = select_resource_type()?;

	let name = match select_existing_resource(manager, resource_type, "view")? {
		Some(n) => n,
		None => return Ok(()),
	};

	let config = manager.config().unwrap();

	match resource_type {
		ResourceType::Skills => {
			let skill = config.skills.iter().find(|s| s.name == name).unwrap();
			println!("\n{}", format!("═══ Skill: {} ═══", name).bold().cyan());
			println!("{}", serde_json::to_string_pretty(skill)?);
		}
		ResourceType::Mcps => {
			let mcp = config.mcps.iter().find(|m| m.name == name).unwrap();
			println!(
				"\n{}",
				format!("═══ MCP Server: {} ═══", name).bold().cyan()
			);
			println!("{}", serde_json::to_string_pretty(mcp)?);
		}
	}

	Ok(())
}

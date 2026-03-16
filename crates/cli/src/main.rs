use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

use aghub_core::{
    adapters::create_adapter, manager::ConfigManager, models::AgentType, paths::find_project_root,
};

mod commands;

use commands::{add, delete, disable, enable, get, update};

/// Global verbose flag used by the eprintln_verbose macro
static mut VERBOSE: bool = false;

/// Set the verbose flag
pub fn set_verbose(verbose: bool) {
    unsafe {
        VERBOSE = verbose;
    }
}

/// Check if verbose mode is enabled
pub fn is_verbose() -> bool {
    unsafe { VERBOSE }
}

/// Print verbose message to stderr (prefixed with "# ")
#[macro_export]
macro_rules! eprintln_verbose {
    ($($arg:tt)*) => {
        if $crate::is_verbose() {
            eprintln!("# {}", format!($($arg)*));
        }
    };
}

/// CLI tool for managing Code Agent configurations (Claude Code, OpenCode)
#[derive(Parser)]
#[command(name = "agentctl")]
#[command(about = "Manage Code Agent configurations")]
#[command(version)]
struct Cli {
    /// Target agent: claude, opencode
    #[arg(short, long, default_value = "claude")]
    agent: String,

    /// Use global config
    #[arg(short, long, group = "config_scope")]
    global: bool,

    /// Use project config (auto-detects .claude/ or .opencode/)
    #[arg(short, long, group = "config_scope")]
    project: bool,

    /// Enable verbose output (to stderr)
    #[arg(short, long)]
    verbose: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List resources (skills, mcps, sub-agents)
    Get {
        #[arg(value_enum)]
        resource: ResourceType,
    },
    /// Add a resource
    Add {
        #[arg(value_enum)]
        resource: ResourceType,
        name: String,

        /// For skill: Import from file/directory/.skill package path
        #[arg(long, value_name = "PATH")]
        from: Option<PathBuf>,

        /// For MCP: command to run (e.g., "npx -y @modelcontextprotocol/server-filesystem /path")
        #[arg(short, long, group = "mcp_config")]
        command: Option<String>,

        /// For MCP: URL for HTTP/SSE transport (e.g., "http://localhost:3000")
        #[arg(short, long, group = "mcp_config")]
        url: Option<String>,

        /// For MCP with URL: Transport type (streamable-http, sse)
        #[arg(short, long, value_name = "TYPE", default_value = "streamable-http")]
        transport: String,

        /// For MCP with URL: HTTP headers (e.g., "Authorization:Bearer token")
        #[arg(long = "header", value_name = "KEY:VALUE")]
        headers: Vec<String>,

        /// For MCP with command: Environment variables (e.g., "KEY=value")
        #[arg(short = 'e', long = "env", value_name = "KEY=VALUE")]
        env_vars: Vec<String>,

        /// For skill/sub-agent: Description
        #[arg(short, long)]
        description: Option<String>,

        /// For skill: Author name
        #[arg(long)]
        author: Option<String>,

        /// For skill: Version
        #[arg(short, long)]
        version: Option<String>,

        /// For skill: Comma-separated list of tool names
        #[arg(long, value_delimiter = ',')]
        tools: Vec<String>,

        /// For sub-agent: Model identifier
        #[arg(short, long)]
        model: Option<String>,

        /// For sub-agent: Instructions/system prompt
        #[arg(short, long)]
        instructions: Option<String>,
    },
    /// Update an existing resource
    Update {
        #[arg(value_enum)]
        resource: ResourceType,
        name: String,

        /// For MCP: command to run
        #[arg(short, long, group = "mcp_config")]
        command: Option<String>,

        /// For MCP: URL for HTTP/SSE transport
        #[arg(short, long, group = "mcp_config")]
        url: Option<String>,

        /// For MCP with URL: Transport type (streamable-http, sse)
        #[arg(short, long, value_name = "TYPE", default_value = "streamable-http")]
        transport: String,

        /// For MCP with URL: HTTP headers
        #[arg(long = "header", value_name = "KEY:VALUE")]
        headers: Vec<String>,

        /// For MCP with command: Environment variables
        #[arg(short = 'e', long = "env", value_name = "KEY=VALUE")]
        env_vars: Vec<String>,

        /// For skill/sub-agent: Description
        #[arg(short, long)]
        description: Option<String>,

        /// For skill: Author name
        #[arg(long)]
        author: Option<String>,

        /// For skill: Version
        #[arg(short, long)]
        version: Option<String>,

        /// For skill: Comma-separated list of tool names
        #[arg(long, value_delimiter = ',')]
        tools: Vec<String>,

        /// For sub-agent: Model identifier
        #[arg(short, long)]
        model: Option<String>,

        /// For sub-agent: Instructions/system prompt
        #[arg(short, long)]
        instructions: Option<String>,
    },
    /// Delete a resource permanently
    Delete {
        #[arg(value_enum)]
        resource: ResourceType,
        name: String,
    },
    /// Disable a resource (keeps in config)
    Disable {
        #[arg(value_enum)]
        resource: ResourceType,
        name: String,
    },
    /// Enable a previously disabled resource
    Enable {
        #[arg(value_enum)]
        resource: ResourceType,
        name: String,
    },
    /// Show detailed info about a resource
    Describe {
        #[arg(value_enum)]
        resource: ResourceType,
        name: String,
    },
}

#[derive(ValueEnum, Clone, Copy, Debug)]
enum ResourceType {
    #[value(alias = "skill")]
    Skills,
    #[value(alias = "mcp")]
    Mcps,
    #[value(alias = "sub-agent", alias = "agent")]
    #[clap(name = "sub-agents")]
    SubAgents,
}


fn main() -> Result<()> {
    let cli = Cli::parse();

    // Set global verbose flag
    set_verbose(cli.verbose);

    // Parse agent type
    let agent_type = cli
        .agent
        .parse::<AgentType>()
        .map_err(|e| anyhow::anyhow!("Unknown agent type: {} (valid: claude, opencode)", e))?;
    eprintln_verbose!("Agent type: {}", cli.agent);

    // Determine config scope
    let (global, project_root) = if cli.project {
        let current_dir = std::env::current_dir()?;
        let root = find_project_root(&current_dir)
            .or(Some(current_dir))
            .context("Could not determine project root. Use -g for global config or run from within a project.")?;
        (false, Some(root))
    } else {
        (cli.global || !cli.project, None)
    };

    let scope = if global { "global" } else { "project" };
    eprintln_verbose!("Config scope: {}", scope);

    // Create adapter and manager
    let adapter = create_adapter(agent_type);
    let mut manager = if let Some(ref root) = project_root {
        ConfigManager::new(adapter, false, Some(root))
    } else {
        ConfigManager::new(adapter, global, None)
    };
    eprintln_verbose!("Config manager created");
    eprintln_verbose!("Config file: {}", manager.config_path().display());

    // Load existing config (or fail if not found)
    eprintln_verbose!("Loading configuration...");
    match manager.load() {
        Ok(_) => {
            eprintln_verbose!("Configuration loaded successfully");
        }
        Err(e) => {
            // If config not found and we're doing a read operation, that's an error
            // If config not found and we're adding, that's okay - we'll create it
            let is_add = matches!(cli.command, Commands::Add { .. });
            if is_add {
                eprintln_verbose!("No existing config found, will create new configuration");
            } else {
                return Err(anyhow::anyhow!("Failed to load config: {}", e));
            }
        }
    }

    // Execute command
    match cli.command {
        Commands::Get { resource } => get::execute(&manager, resource),
        Commands::Add {
            resource,
            name,
            from,
            command,
            url,
            transport,
            headers,
            env_vars,
            description,
            author,
            version,
            tools,
            model,
            instructions,
        } => add::execute(
            &mut manager,
            resource,
            name,
            from,
            command,
            url,
            transport,
            headers,
            env_vars,
            description,
            author,
            version,
            tools,
            model,
            instructions,
        ),
        Commands::Update {
            resource,
            name,
            command,
            url,
            transport,
            headers,
            env_vars,
            description,
            author,
            version,
            tools,
            model,
            instructions,
        } => update::execute(
            &mut manager,
            resource,
            name,
            command,
            url,
            transport,
            headers,
            env_vars,
            description,
            author,
            version,
            tools,
            model,
            instructions,
        ),
        Commands::Delete { resource, name } => delete::execute(&mut manager, resource, name),
        Commands::Disable { resource, name } => disable::execute(&mut manager, resource, name),
        Commands::Enable { resource, name } => enable::execute(&mut manager, resource, name),
        Commands::Describe { resource, name } => describe::execute(&manager, resource, name),
    }
}

// Describe command - outputs JSON
mod describe {
    use super::*;

    pub fn execute(manager: &ConfigManager, resource: ResourceType, name: String) -> Result<()> {
        let config = manager.config().context("No configuration loaded")?;

        let resource_type_str = match resource {
            ResourceType::Skills => "skill",
            ResourceType::Mcps => "mcp",
            ResourceType::SubAgents => "sub-agent",
        };
        eprintln_verbose!("Describing {}: {}", resource_type_str, name);

        match resource {
            ResourceType::Skills => {
                let skill = config
                    .skills
                    .iter()
                    .find(|s| s.name == name)
                    .with_context(|| format!("Skill '{}' not found", name))?;
                eprintln_verbose!("Found skill: {}", skill.name);
                println!("{}", serde_json::to_string_pretty(skill)?);
            }
            ResourceType::Mcps => {
                let mcp = config
                    .mcps
                    .iter()
                    .find(|m| m.name == name)
                    .with_context(|| format!("MCP server '{}' not found", name))?;
                eprintln_verbose!("Found MCP server: {}", mcp.name);
                println!("{}", serde_json::to_string_pretty(mcp)?);
            }
            ResourceType::SubAgents => {
                let agent = config
                    .sub_agents
                    .iter()
                    .find(|a| a.name == name)
                    .with_context(|| format!("Sub-agent '{}' not found", name))?;
                eprintln_verbose!("Found sub-agent: {}", agent.name);
                println!("{}", serde_json::to_string_pretty(agent)?);
            }
        }

        Ok(())
    }
}

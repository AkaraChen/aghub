use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use colored::Colorize;

use aghub_core::{
    adapters::create_adapter,
    manager::ConfigManager,
    models::AgentType,
    paths::find_project_root,
};

mod commands;

use commands::{add, delete, disable, enable, get, update};

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

        /// For MCP: command to run (e.g., "npx -y @modelcontextprotocol/server-filesystem /path")
        #[arg(short, long, group = "mcp_config")]
        command: Option<String>,

        /// For MCP: URL for SSE transport (e.g., "http://localhost:3000")
        #[arg(short, long, group = "mcp_config")]
        url: Option<String>,

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

        /// For skill: Source URL or path
        #[arg(short, long)]
        source: Option<String>,

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

        /// For MCP: URL for SSE transport
        #[arg(short, long, group = "mcp_config")]
        url: Option<String>,

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

        /// For skill: Source URL or path
        #[arg(short, long)]
        source: Option<String>,

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

impl ResourceType {
    fn as_str(&self) -> &'static str {
        match self {
            ResourceType::Skills => "skill",
            ResourceType::Mcps => "MCP server",
            ResourceType::SubAgents => "sub-agent",
        }
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Parse agent type
    let agent_type = cli
        .agent
        .parse::<AgentType>()
        .map_err(|e| anyhow::anyhow!("Unknown agent type: {} (valid: claude, opencode)", e))?;

    // Determine config scope
    let (global, project_root) = if cli.project {
        let current_dir = std::env::current_dir()?;
        let root = find_project_root(&current_dir)
            .or_else(|| Some(current_dir))
            .context("Could not determine project root. Use -g for global config or run from within a project.")?;
        (false, Some(root))
    } else {
        (cli.global || !cli.project, None)
    };

    // Create adapter and manager
    let adapter = create_adapter(agent_type);
    let mut manager = if let Some(ref root) = project_root {
        ConfigManager::new(adapter, false, Some(root))
    } else {
        ConfigManager::new(adapter, global, None)
    };

    // Load existing config (or fail if not found)
    match manager.load() {
        Ok(_) => {}
        Err(e) => {
            // If config not found and we're doing a read operation, that's an error
            // If config not found and we're adding, that's okay - we'll create it
            let is_add = matches!(cli.command, Commands::Add { .. });
            if !is_add {
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
            command,
            url,
            headers,
            env_vars,
            description,
            author,
            version,
            source,
            tools,
            model,
            instructions,
        } => add::execute(
            &mut manager,
            resource,
            name,
            command,
            url,
            headers,
            env_vars,
            description,
            author,
            version,
            source,
            tools,
            model,
            instructions,
        ),
        Commands::Update {
            resource,
            name,
            command,
            url,
            headers,
            env_vars,
            description,
            author,
            version,
            source,
            tools,
            model,
            instructions,
        } => update::execute(
            &mut manager,
            resource,
            name,
            command,
            url,
            headers,
            env_vars,
            description,
            author,
            version,
            source,
            tools,
            model,
            instructions,
        ),
        Commands::Delete { resource, name } => delete::execute(&mut manager, resource, name),
        Commands::Disable { resource, name } => disable::execute(&mut manager, resource, name),
        Commands::Enable { resource, name } => enable::execute(&mut manager, resource, name),
        Commands::Describe { resource, name } => {
            describe::execute(&manager, resource, name)
        }
    }
}

// Stub module for describe command
mod describe {
    use super::*;

    pub fn execute(
        manager: &ConfigManager,
        resource: ResourceType,
        name: String,
    ) -> Result<()> {
        let config = manager
            .config()
            .context("No configuration loaded")?;

        match resource {
            ResourceType::Skills => {
                let skill = config
                    .skills
                    .iter()
                    .find(|s| s.name == name)
                    .with_context(|| format!("Skill '{}' not found", name))?;
                println!("{}", format!("Skill: {}", skill.name).bold().underline());
                println!("  Enabled: {}", if skill.enabled { "yes".green() } else { "no".red() });
                if let Some(ref source) = skill.source {
                    println!("  Source: {}", source);
                }
                if let Some(ref desc) = skill.description {
                    println!("  Description: {}", desc);
                }
                if let Some(ref author) = skill.author {
                    println!("  Author: {}", author);
                }
                if let Some(ref version) = skill.version {
                    println!("  Version: {}", version);
                }
                if !skill.tools.is_empty() {
                    println!("  Tools: {}", skill.tools.join(", "));
                }
            }
            ResourceType::Mcps => {
                let mcp = config
                    .mcps
                    .iter()
                    .find(|m| m.name == name)
                    .with_context(|| format!("MCP server '{}' not found", name))?;
                println!("{}", format!("MCP Server: {}", mcp.name).bold().underline());
                println!("  Enabled: {}", if mcp.enabled { "yes".green() } else { "no".red() });
                match &mcp.transport {
                    aghub_core::models::McpTransport::Command { command, args, env } => {
                        println!("  Type: command (stdio)");
                        println!("  Command: {}", command);
                        if !args.is_empty() {
                            println!("  Args: {}", args.join(" "));
                        }
                        if let Some(ref env) = env {
                            println!("  Environment:");
                            for (k, v) in env {
                                println!("    {}={}", k, v);
                            }
                        }
                    }
                    aghub_core::models::McpTransport::Url { url, headers } => {
                        println!("  Type: URL (SSE)");
                        println!("  URL: {}", url);
                        if let Some(ref headers) = headers {
                            println!("  Headers:");
                            for (k, v) in headers {
                                println!("    {}: {}", k, v);
                            }
                        }
                    }
                }
            }
            ResourceType::SubAgents => {
                let agent = config
                    .sub_agents
                    .iter()
                    .find(|a| a.name == name)
                    .with_context(|| format!("Sub-agent '{}' not found", name))?;
                println!("{}", format!("Sub-agent: {}", agent.name).bold().underline());
                println!("  Enabled: {}", if agent.enabled { "yes".green() } else { "no".red() });
                if let Some(ref desc) = agent.description {
                    println!("  Description: {}", desc);
                }
                if let Some(ref model) = agent.model {
                    println!("  Model: {}", model);
                }
                if let Some(ref instructions) = agent.instructions {
                    println!("  Instructions: {}", instructions);
                }
            }
        }

        Ok(())
    }
}

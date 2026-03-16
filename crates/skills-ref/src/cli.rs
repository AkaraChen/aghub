//! CLI for skills-ref library.

use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "skills-ref")]
#[command(about = "Reference library for Agent Skills")]
#[command(version)]
struct Cli {
	#[command(subcommand)]
	command: Commands,
}

#[derive(Subcommand)]
enum Commands {
	/// Validate a skill directory
	///
	/// Checks that the skill has a valid SKILL.md with proper frontmatter,
	/// correct naming conventions, and required fields.
	///
	/// Exit codes:
	///   0: Valid skill
	///   1: Validation errors found
	Validate {
		/// Path to skill directory or SKILL.md file
		skill_path: PathBuf,
	},

	/// Read and print skill properties as JSON
	///
	/// Parses the YAML frontmatter from SKILL.md and outputs the
	/// properties as JSON.
	///
	/// Exit codes:
	///   0: Success
	///   1: Parse error
	ReadProperties {
		/// Path to skill directory or SKILL.md file
		skill_path: PathBuf,
	},

	/// Generate <available_skills> XML for agent prompts
	///
	/// Accepts one or more skill directories.
	///
	/// Exit codes:
	///   0: Success
	///   1: Error
	ToPrompt {
		/// Paths to skill directories or SKILL.md files
		skill_paths: Vec<PathBuf>,
	},
}

fn is_skill_md_file(path: &Path) -> bool {
	path.is_file()
		&& path
			.file_name()
			.map(|n| n.to_string_lossy().to_lowercase() == "skill.md")
			.unwrap_or(false)
}

fn main() {
	let cli = Cli::parse();

	match cli.command {
		Commands::Validate { skill_path } => {
			let skill_path = if is_skill_md_file(&skill_path) {
				skill_path.parent().unwrap_or(&skill_path).to_path_buf()
			} else {
				skill_path
			};

			let errors = skills_ref::validator::validate(&skill_path);

			if !errors.is_empty() {
				eprintln!("Validation failed for {}:", skill_path.display());
				for error in &errors {
					eprintln!("  - {}", error);
				}
				std::process::exit(1);
			} else {
				println!("Valid skill: {}", skill_path.display());
			}
		}

		Commands::ReadProperties { skill_path } => {
			let skill_path = if is_skill_md_file(&skill_path) {
				skill_path.parent().unwrap_or(&skill_path).to_path_buf()
			} else {
				skill_path
			};

			match skills_ref::parser::read_properties(&skill_path) {
				Ok(props) => {
					println!(
						"{}",
						serde_json::to_string_pretty(&props.to_dict()).unwrap()
					);
				}
				Err(e) => {
					eprintln!("Error: {}", e);
					std::process::exit(1);
				}
			}
		}

		Commands::ToPrompt { skill_paths } => {
			if skill_paths.is_empty() {
				eprintln!("Error: At least one skill path is required");
				std::process::exit(1);
			}

			let resolved_paths: Vec<PathBuf> = skill_paths
				.into_iter()
				.map(|p| {
					if is_skill_md_file(&p) {
						p.parent().unwrap_or(&p).to_path_buf()
					} else {
						p
					}
				})
				.collect();

			match skills_ref::prompt::to_prompt(&resolved_paths) {
				Ok(output) => {
					println!("{}", output);
				}
				Err(e) => {
					eprintln!("Error: {}", e);
					std::process::exit(1);
				}
			}
		}
	}
}

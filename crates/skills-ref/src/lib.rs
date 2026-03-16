//! Reference library for Agent Skills.
//!
//! This library provides functionality to parse SKILL.md files, validate skill properties,
//! and generate XML prompt blocks for agent system prompts.
//!
//! # Example
//!
//! ```rust,no_run
//! use skills_ref::parser::read_properties;
//! use skills_ref::validator::validate;
//! use skills_ref::prompt::to_prompt;
//! use std::path::Path;
//!
//! // Read skill properties from a directory
//! let props = read_properties(Path::new("/path/to/skill")).unwrap();
//! println!("Skill name: {}", props.name);
//!
//! // Validate a skill directory
//! let errors = validate(Path::new("/path/to/skill"));
//! if errors.is_empty() {
//!     println!("Skill is valid!");
//! }
//!
//! // Generate XML prompt
//! let xml = to_prompt(&[Path::new("/path/to/skill").to_path_buf()]).unwrap();
//! println!("{}", xml);
//! ```

pub mod errors;
pub mod models;
pub mod parser;
pub mod prompt;
pub mod validator;

// Re-export commonly used items
pub use errors::{ParseError, SkillError, ValidationError};
pub use models::SkillProperties;
pub use parser::{find_skill_md, parse_frontmatter, read_properties};
pub use prompt::to_prompt;
pub use validator::{validate, validate_metadata};

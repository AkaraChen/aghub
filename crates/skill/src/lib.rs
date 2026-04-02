//! Skill packaging and parsing library.
//!
//! This library provides functionality to pack, unpack, parse, and validate
//! skill packages in .skill (zip) format. It extends skills-ref with
//! packaging capabilities.
//!
//! # Example
//!
//! ```rust,no_run
//! use skill::package::{pack, unpack};
//! use skill::parser::parse;
//! use std::path::Path;
//!
//! // Pack a skill directory
//! pack(Path::new("/path/to/skill"), Path::new("/output/skill.skill")).unwrap();
//!
//! // Unpack a .skill file
//! unpack(Path::new("/path/to/skill.skill"), Path::new("/output/dir")).unwrap();
//!
//! // Parse any skill format (auto-detect)
//! let skill = parse(Path::new("/path/to/skill.skill")).unwrap();
//! println!("Skill name: {}", skill.name);
//! ```

pub mod error;
pub mod lock;
pub mod model;
pub mod package;
pub mod parser;
pub mod sanitize;
pub mod scan;
pub mod validator;

// Re-export commonly used items
pub use error::SkillError;
pub use lock::global::{
	get_all_locked_skills, get_skill_from_lock, get_skill_lock_path,
	get_skills_by_source, read_skill_lock, remove_skill_from_lock,
	DismissedPrompts, SkillLockEntry, SkillLockFile,
};
pub use lock::local::{
	add_skill_to_local_lock, get_local_lock_path, read_local_lock,
	remove_skill_from_local_lock, write_local_lock, LocalSkillLockEntry,
	LocalSkillLockFile,
};
pub use model::{Skill, SkillSource};
pub use package::{pack, read_skill_md, unpack};
pub use parser::{
	parse, parse_skill_dir, parse_skill_file, parse_skill_md, parse_zip,
};
pub use sanitize::sanitize_name;
pub use scan::{scan_skills, ScanError, ScanOptions};
pub use validator::{
	validate, validate_skill_dir, validate_skill_file, validate_zip,
};

// Re-export from skills-ref for convenience
pub use skills_ref::{validate as validate_skill_properties, SkillProperties};

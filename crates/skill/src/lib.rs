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

pub mod content;
pub mod copy;
pub mod error;
pub mod install;
pub mod link;
pub mod lock;
pub mod model;
pub mod package;
pub mod parser;
pub mod relationship;
pub mod sanitize;
pub mod scan;
pub mod snapshot;
pub mod validator;

/// Maximum directory depth below a logical skill root.
pub const MAX_SKILL_CONTENT_DEPTH: usize = 16;
/// Maximum files and directories in one skill, including `SKILL.md`.
pub const MAX_SKILL_CONTENT_FILES: usize = 512;
/// Maximum total uncompressed file bytes in one skill.
pub const MAX_SKILL_CONTENT_BYTES: usize = 32 * 1024 * 1024;
pub(crate) const REPOSITORY_METADATA_DIRS: [&str; 3] = [".git", ".hg", ".svn"];

/// Resource directories installed alongside a standalone skill document.
pub const RESOURCE_DIR_NAMES: [&str; 3] = ["scripts", "references", "assets"];

/// Return whether a path component names repository metadata.
pub fn is_repository_metadata_dir(name: &std::ffi::OsStr) -> bool {
	name.to_str().is_some_and(|name| {
		REPOSITORY_METADATA_DIRS
			.iter()
			.any(|item| name.eq_ignore_ascii_case(item))
	})
}

// Re-export commonly used items
#[cfg(unix)]
pub use content::{
	open_skill_content_directory, read_skill_content_directory,
	OpenSkillContentDirectoryEntry, SkillContentDirectoryEntries,
};
pub use content::{
	open_skill_content_file, read_skill_content, read_skill_directory_content,
	read_skill_document, write_skill_document_atomic, SkillContentFile,
	SkillContentSnapshot,
};
pub use error::SkillError;
pub use install::{
	discover_repo_skills, discover_repo_skills_with_limit,
	lock_skill_file_path, write_global_install_lock,
	write_global_install_locks, write_project_install_lock,
	write_project_install_locks, InstallLockSource, InstallLockUpdate,
	RepoDiscoveredSkill, RepoDiscoveryError,
};
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
	rename_skill_md, update_skill_md,
};
pub use sanitize::sanitize_name;
pub use scan::{scan_skills, ScanError, ScanOptions};
pub use validator::{
	validate, validate_skill_dir, validate_skill_file, validate_zip,
};

// Re-export from skills-ref for convenience
pub use skills_ref::{validate as validate_skill_properties, SkillProperties};

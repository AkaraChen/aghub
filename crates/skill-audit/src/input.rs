//! Prepared input for an audit run — everything already read into memory.

/// One resource bundled with a skill (a script, reference, or asset file).
#[derive(Debug, Clone)]
pub struct ResourceFile {
	/// Path relative to the skill root, e.g. `"scripts/setup.sh"`.
	pub path: String,
	pub content: Vec<u8>,
}

/// Everything the offline audit needs.
///
/// `skill_md` is the **raw** UTF-8 SKILL.md text including frontmatter —
/// injection detection must see the whole file, not the parsed markdown body.
#[derive(Debug, Clone)]
pub struct AuditInput {
	pub name: String,
	pub skill_md: String,
	pub resources: Vec<ResourceFile>,
}

#[cfg(feature = "from-path")]
mod from_path {
	use super::{AuditInput, ResourceFile};
	use std::io;
	use std::path::Path;

	impl AuditInput {
		/// Build an input from an on-disk skill **directory**.
		pub fn from_skill_dir(dir: &Path) -> io::Result<Self> {
			let content = skill::read_skill_directory_content(dir)
				.map_err(skill_error_to_io)?;
			Ok(from_content(content, directory_name(dir)))
		}

		/// Build an input from a directory, Markdown file, or skill package.
		pub fn from_skill_path(path: &Path) -> io::Result<Self> {
			let content =
				skill::read_skill_content(path).map_err(skill_error_to_io)?;
			let fallback = if path.is_dir() {
				directory_name(path)
			} else {
				file_stem(path)
			};
			Ok(from_content(content, fallback))
		}
	}

	fn from_content(
		content: skill::SkillContentSnapshot,
		fallback_name: String,
	) -> AuditInput {
		let name = skill::parse_skill_md(&content.skill_md)
			.map(|skill| skill.name)
			.unwrap_or(fallback_name);
		let resources = content
			.resources
			.into_iter()
			.map(|resource| ResourceFile {
				path: resource.path,
				content: resource.content,
			})
			.collect();
		AuditInput {
			name,
			skill_md: content.skill_md,
			resources,
		}
	}

	fn skill_error_to_io(error: skill::SkillError) -> io::Error {
		match error {
			skill::SkillError::Io(error) => error,
			error @ (skill::SkillError::MissingSkillMd { .. }
			| skill::SkillError::NotFound(_)) => {
				io::Error::new(io::ErrorKind::NotFound, error.to_string())
			}
			error => {
				io::Error::new(io::ErrorKind::InvalidData, error.to_string())
			}
		}
	}

	fn directory_name(path: &Path) -> String {
		path.file_name()
			.map(|name| name.to_string_lossy().into_owned())
			.unwrap_or_default()
	}

	fn file_stem(path: &Path) -> String {
		path.file_stem()
			.map(|stem| stem.to_string_lossy().into_owned())
			.unwrap_or_default()
	}
}

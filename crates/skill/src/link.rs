use crate::error::Result;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillLinkStatus {
	Valid,
	Broken,
	OutsideRoot,
	Unreadable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillLink {
	pub target: PathBuf,
	pub display_target: Option<String>,
	pub resolved_path: Option<PathBuf>,
	pub status: SkillLinkStatus,
}

pub fn inspect_skill_link(root: &Path, path: &Path) -> Result<SkillLink> {
	let canonical_root = std::fs::canonicalize(root)?;
	let target = std::fs::read_link(path)?;
	let candidate = if target.is_absolute() {
		target.clone()
	} else {
		path.parent().unwrap_or(root).join(&target)
	};
	let (status, resolved_path) = match std::fs::canonicalize(candidate) {
		Ok(resolved) if resolved.starts_with(&canonical_root) => {
			(SkillLinkStatus::Valid, Some(resolved))
		}
		Ok(resolved) => (SkillLinkStatus::OutsideRoot, Some(resolved)),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			(SkillLinkStatus::Broken, None)
		}
		Err(_) => (SkillLinkStatus::Unreadable, None),
	};
	let display_target = resolved_path
		.as_deref()
		.filter(|_| status == SkillLinkStatus::Valid)
		.and_then(|resolved| resolved.strip_prefix(&canonical_root).ok())
		.map(|relative| {
			if relative.as_os_str().is_empty() {
				".".to_string()
			} else {
				relative.to_string_lossy().replace('\\', "/")
			}
		});

	Ok(SkillLink {
		target,
		display_target,
		resolved_path,
		status,
	})
}

#[cfg(all(test, unix))]
mod tests {
	use super::*;
	use tempfile::tempdir;

	#[test]
	fn reports_link_within_skill_root() {
		let temp = tempdir().unwrap();
		let root = temp.path().join("skill");
		std::fs::create_dir_all(&root).unwrap();
		std::fs::write(root.join("target.txt"), "target").unwrap();
		std::os::unix::fs::symlink("target.txt", root.join("linked.txt"))
			.unwrap();

		let link = inspect_skill_link(&root, &root.join("linked.txt")).unwrap();

		assert_eq!(link.target, PathBuf::from("target.txt"));
		assert_eq!(link.display_target.as_deref(), Some("target.txt"));
		assert_eq!(link.status, SkillLinkStatus::Valid);
		assert_eq!(
			link.resolved_path,
			Some(std::fs::canonicalize(root.join("target.txt")).unwrap())
		);
	}

	#[test]
	fn reports_broken_link() {
		let temp = tempdir().unwrap();
		let root = temp.path().join("skill");
		std::fs::create_dir_all(&root).unwrap();
		std::os::unix::fs::symlink("missing.txt", root.join("linked.txt"))
			.unwrap();

		let link = inspect_skill_link(&root, &root.join("linked.txt")).unwrap();

		assert_eq!(link.status, SkillLinkStatus::Broken);
		assert!(link.display_target.is_none());
		assert!(link.resolved_path.is_none());
	}

	#[test]
	fn reports_link_outside_skill_root() {
		let temp = tempdir().unwrap();
		let root = temp.path().join("skill");
		std::fs::create_dir_all(&root).unwrap();
		std::fs::write(temp.path().join("outside.txt"), "outside").unwrap();
		std::os::unix::fs::symlink("../outside.txt", root.join("linked.txt"))
			.unwrap();

		let link = inspect_skill_link(&root, &root.join("linked.txt")).unwrap();

		assert_eq!(link.status, SkillLinkStatus::OutsideRoot);
		assert!(link.display_target.is_none());
	}
}

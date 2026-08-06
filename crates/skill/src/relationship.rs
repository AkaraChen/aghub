use std::fs::Metadata;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FileIdentity {
	volume: u64,
	file: u64,
}

pub fn hard_link_identity(metadata: &Metadata) -> Option<FileIdentity> {
	if !metadata.is_file() {
		return None;
	}

	platform_hard_link_identity(metadata)
}

#[cfg(unix)]
fn platform_hard_link_identity(metadata: &Metadata) -> Option<FileIdentity> {
	use std::os::unix::fs::MetadataExt;

	(metadata.nlink() > 1).then_some(FileIdentity {
		volume: metadata.dev(),
		file: metadata.ino(),
	})
}

#[cfg(windows)]
fn platform_hard_link_identity(metadata: &Metadata) -> Option<FileIdentity> {
	use std::os::windows::fs::MetadataExt;

	if metadata.number_of_links()? <= 1 {
		return None;
	}
	Some(FileIdentity {
		volume: metadata.volume_serial_number()? as u64,
		file: metadata.file_index()?,
	})
}

#[cfg(not(any(unix, windows)))]
fn platform_hard_link_identity(_metadata: &Metadata) -> Option<FileIdentity> {
	None
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn identifies_two_paths_for_the_same_regular_file() {
		let temp = tempfile::tempdir().unwrap();
		let first = temp.path().join("first.txt");
		let second = temp.path().join("second.txt");
		std::fs::write(&first, "same file").unwrap();
		std::fs::hard_link(&first, &second).unwrap();

		let first_identity =
			hard_link_identity(&std::fs::metadata(&first).unwrap());
		let second_identity =
			hard_link_identity(&std::fs::metadata(&second).unwrap());

		assert!(first_identity.is_some());
		assert_eq!(first_identity, second_identity);
	}

	#[test]
	fn ignores_an_independent_file() {
		let temp = tempfile::tempdir().unwrap();
		let file = temp.path().join("file.txt");
		std::fs::write(&file, "independent").unwrap();

		assert_eq!(hard_link_identity(&std::fs::metadata(file).unwrap()), None);
	}
}

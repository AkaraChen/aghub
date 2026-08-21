use std::{fs::Metadata, io, path::Path};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FileIdentity {
	volume: u64,
	file: u64,
}

pub fn hard_link_identity(
	path: &Path,
	metadata: &Metadata,
) -> io::Result<Option<FileIdentity>> {
	if !metadata.is_file() {
		return Ok(None);
	}

	platform_hard_link_identity(path, metadata)
}

#[cfg(unix)]
fn platform_hard_link_identity(
	_path: &Path,
	metadata: &Metadata,
) -> io::Result<Option<FileIdentity>> {
	use std::os::unix::fs::MetadataExt;

	Ok((metadata.nlink() > 1).then_some(FileIdentity {
		volume: metadata.dev(),
		file: metadata.ino(),
	}))
}

#[cfg(windows)]
fn platform_hard_link_identity(
	path: &Path,
	_metadata: &Metadata,
) -> io::Result<Option<FileIdentity>> {
	use std::{mem::MaybeUninit, os::windows::io::AsRawHandle};
	use windows_sys::Win32::Storage::FileSystem::{
		GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
	};

	let file = std::fs::File::open(path)?;
	let mut information = MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
	// The file handle remains open for the call and the API initializes the
	// structure only when it reports success.
	let succeeded = unsafe {
		GetFileInformationByHandle(
			file.as_raw_handle(),
			information.as_mut_ptr(),
		)
	};
	if succeeded == 0 {
		return Err(io::Error::last_os_error());
	}
	// SAFETY: GetFileInformationByHandle returned success above.
	let information = unsafe { information.assume_init() };
	if information.nNumberOfLinks <= 1 {
		return Ok(None);
	}

	Ok(Some(FileIdentity {
		volume: u64::from(information.dwVolumeSerialNumber),
		file: (u64::from(information.nFileIndexHigh) << 32)
			| u64::from(information.nFileIndexLow),
	}))
}

#[cfg(not(any(unix, windows)))]
fn platform_hard_link_identity(
	_path: &Path,
	_metadata: &Metadata,
) -> io::Result<Option<FileIdentity>> {
	Ok(None)
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
			hard_link_identity(&first, &std::fs::metadata(&first).unwrap())
				.unwrap();
		let second_identity =
			hard_link_identity(&second, &std::fs::metadata(&second).unwrap())
				.unwrap();

		assert!(first_identity.is_some());
		assert_eq!(first_identity, second_identity);
	}

	#[test]
	fn ignores_an_independent_file() {
		let temp = tempfile::tempdir().unwrap();
		let file = temp.path().join("file.txt");
		std::fs::write(&file, "independent").unwrap();

		assert_eq!(
			hard_link_identity(&file, &std::fs::metadata(&file).unwrap())
				.unwrap(),
			None
		);
	}
}

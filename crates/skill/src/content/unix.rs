use super::rejected_path;
use crate::error::{Result, SkillError};
use rustix::fs::{
	fstat, openat, statat, AtFlags, Dir, FileType, Mode, OFlags, Stat, CWD,
};
use std::ffi::{OsStr, OsString};
use std::fs::{File, Metadata};
use std::os::unix::ffi::OsStringExt;
use std::path::{Path, PathBuf};

// NONBLOCK keeps a FIFO type swap from blocking before fstat rejects it.
const CONTENT_OPEN_FLAGS: OFlags = OFlags::RDONLY
	.union(OFlags::CLOEXEC)
	.union(OFlags::NOFOLLOW)
	.union(OFlags::NONBLOCK);

/// One source entry opened relative to its already-open parent directory.
pub struct OpenSkillContentDirectoryEntry {
	name: OsString,
	file: File,
	metadata: Metadata,
}

impl OpenSkillContentDirectoryEntry {
	/// Return the entry name relative to its opened parent directory.
	pub fn file_name(&self) -> &OsStr {
		&self.name
	}

	/// Consume the entry into its name, open file, and descriptor metadata.
	pub fn into_parts(self) -> (OsString, File, Metadata) {
		(self.name, self.file, self.metadata)
	}
}

/// Iterator over entries opened without resolving their parent path again.
pub struct SkillContentDirectoryEntries<'a> {
	directory: &'a File,
	display_path: PathBuf,
	stream: Dir,
}

impl Iterator for SkillContentDirectoryEntries<'_> {
	type Item = Result<OpenSkillContentDirectoryEntry>;

	fn next(&mut self) -> Option<Self::Item> {
		loop {
			let entry = self.stream.next()?.map_err(io_error);
			let entry = match entry {
				Ok(entry) => entry,
				Err(error) => return Some(Err(error)),
			};
			let name = entry.file_name().to_bytes();
			if matches!(name, b"." | b"..") {
				continue;
			}

			let name = OsString::from_vec(name.to_vec());
			return Some(open_directory_entry(
				self.directory,
				&self.display_path,
				name,
			));
		}
	}
}

/// Open a directory as the stable root of a skill-content traversal.
pub fn open_skill_content_directory(path: &Path) -> Result<File> {
	let before =
		statat(CWD, path, AtFlags::SYMLINK_NOFOLLOW).map_err(io_error)?;
	if FileType::from_raw_mode(before.st_mode) == FileType::Symlink {
		return Err(rejected_path(path, "symbolic link"));
	}
	if FileType::from_raw_mode(before.st_mode) != FileType::Directory {
		return Err(rejected_path(path, "non-directory"));
	}

	let descriptor = openat(
		CWD,
		path,
		CONTENT_OPEN_FLAGS | OFlags::DIRECTORY,
		Mode::empty(),
	)
	.map_err(io_error)?;
	let after = fstat(&descriptor).map_err(io_error)?;
	ensure_same_entry(path, &before, &after)?;
	let file = File::from(descriptor);
	if !file.metadata()?.is_dir() {
		return Err(rejected_path(path, "non-directory"));
	}
	Ok(file)
}

/// Read entries through a stable directory descriptor.
pub fn read_skill_content_directory<'a>(
	directory: &'a File,
	display_path: &Path,
) -> Result<SkillContentDirectoryEntries<'a>> {
	let stream = Dir::read_from(directory).map_err(io_error)?;
	Ok(SkillContentDirectoryEntries {
		directory,
		display_path: display_path.to_path_buf(),
		stream,
	})
}

fn open_directory_entry(
	directory: &File,
	display_path: &Path,
	name: OsString,
) -> Result<OpenSkillContentDirectoryEntry> {
	let path = display_path.join(&name);
	let before = statat(directory, &name, AtFlags::SYMLINK_NOFOLLOW)
		.map_err(io_error)?;
	let file_type = FileType::from_raw_mode(before.st_mode);
	let flags = match file_type {
		FileType::Directory => CONTENT_OPEN_FLAGS | OFlags::DIRECTORY,
		FileType::RegularFile => CONTENT_OPEN_FLAGS,
		FileType::Symlink => return Err(rejected_path(&path, "symbolic link")),
		_ => return Err(rejected_path(&path, "special file")),
	};
	let descriptor =
		openat(directory, &name, flags, Mode::empty()).map_err(io_error)?;
	let after = fstat(&descriptor).map_err(io_error)?;
	ensure_same_entry(&path, &before, &after)?;
	let file = File::from(descriptor);
	let metadata = file.metadata()?;
	if !metadata.is_dir() && !metadata.is_file() {
		return Err(rejected_path(&path, "special file"));
	}

	Ok(OpenSkillContentDirectoryEntry {
		name,
		file,
		metadata,
	})
}

fn ensure_same_entry(path: &Path, before: &Stat, after: &Stat) -> Result<()> {
	if before.st_dev != after.st_dev
		|| before.st_ino != after.st_ino
		|| FileType::from_raw_mode(before.st_mode)
			!= FileType::from_raw_mode(after.st_mode)
	{
		return Err(rejected_path(path, "entry changed while opening"));
	}
	Ok(())
}

fn io_error(error: rustix::io::Errno) -> SkillError {
	SkillError::Io(std::io::Error::from(error))
}

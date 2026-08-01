//! Git clone and remote inspection library.
//!
//! Credentials must be passed explicitly in [`CloneOptions`].
//!
//! # Example
//!
//! ```rust,no_run
//! use aghub_git::{clone_to_temp, CloneOptions};
//!
//! // Clone a repository
//! let temp_dir = clone_to_temp(
//!     CloneOptions::new("https://github.com/user/repo.git")
//! ).unwrap();
//! println!("Cloned to: {}", temp_dir.path().display());
//!
//! // The temp directory is cleaned up automatically when dropped
//! ```
//!
//! # Explicit Credentials
//!
//! You can also provide credentials explicitly:
//!
//! ```rust,no_run
//! use aghub_git::{clone_to_temp, CloneOptions};
//!
//! let temp_dir = clone_to_temp(
//!     CloneOptions::new("https://github.com/user/private-repo.git")
//!         .with_credentials("myuser", "my_personal_access_token")
//! ).unwrap();
//! ```

pub mod clone;
mod command;
pub mod credentials;
pub mod error;
pub mod remote;
pub mod repository;
pub mod source;

// Re-export commonly used items
pub use clone::{
	clone_to_path, clone_to_path_bounded, clone_to_temp, clone_to_temp_bounded,
	clone_to_temp_with_interrupt, CloneLimits, CloneOptions,
};
pub use credentials::{inject_credentials, read_credentials, Credentials};
pub use error::{GitError, Result};
pub use remote::{
	list_remote_branches, list_remote_branches_bounded, RemoteLimits,
	RemoteOptions,
};
pub use repository::current_branch;
pub use source::{
	normalize_repo_source_from_url, resolve_remote_source, RemoteSourceType,
	ResolvedRemoteSource, SourceError,
};

//! Git clone library with credential injection from environment variables.
//!
//! This library provides functionality to clone git repositories into
//! temporary directories with credentials automatically injected from
//! environment variables.
//!
//! # Environment Variables
//!
//! - `GIT_USERNAME`: Git username for authentication
//! - `GIT_PASSWORD`: Git password or personal access token
//!
//! # Example
//!
//! ```rust,no_run
//! use aghub_git::{clone_to_temp, CloneOptions};
//!
//! // Set credentials via environment (or set them before running)
//! std::env::set_var("GIT_USERNAME", "myuser");
//! std::env::set_var("GIT_PASSWORD", "mytoken");
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
pub mod credentials;
pub mod error;
pub mod remote;

// Re-export commonly used items
pub use clone::{clone_to_path, clone_to_temp, CloneOptions};
pub use credentials::{inject_credentials, read_credentials, Credentials};
pub use error::{GitError, Result};
pub use remote::{list_remote_branches, RemoteOptions};

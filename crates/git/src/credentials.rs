//! Credential handling from environment variables.

use std::env;

use crate::error::{GitError, Result};

/// Environment variable names for git credentials.
pub const GIT_USERNAME_ENV: &str = "GIT_USERNAME";
pub const GIT_PASSWORD_ENV: &str = "GIT_PASSWORD";

/// Git credentials extracted from environment variables.
#[derive(Debug, Clone)]
pub struct Credentials {
	/// Username for git authentication.
	pub username: String,
	/// Password or token for git authentication.
	pub password: String,
}

/// Read git credentials from environment variables.
///
/// Returns `None` if either `GIT_USERNAME` or `GIT_PASSWORD` is not set.
///
/// # Example
///
/// ```rust,no_run
/// use aghub_git::credentials::read_credentials;
///
/// // Set env vars before calling
/// std::env::set_var("GIT_USERNAME", "myuser");
/// std::env::set_var("GIT_PASSWORD", "mytoken");
///
/// let creds = read_credentials();
/// assert!(creds.is_some());
/// ```
pub fn read_credentials() -> Option<Credentials> {
	let username = env::var(GIT_USERNAME_ENV).ok()?;
	let password = env::var(GIT_PASSWORD_ENV).ok()?;

	if username.is_empty() || password.is_empty() {
		return None;
	}

	Some(Credentials { username, password })
}

/// Inject credentials into an HTTPS URL.
///
/// Transforms `https://github.com/user/repo.git` into
/// `https://username:password@github.com/user/repo.git`.
///
/// # Errors
///
/// Returns `GitError::InvalidUrl` if the URL cannot be parsed.
/// Returns `GitError::NotHttps` if the URL is not HTTPS.
///
/// # Example
///
/// ```rust,no_run
/// use aghub_git::credentials::{inject_credentials, Credentials};
///
/// let creds = Credentials {
///     username: "myuser".to_string(),
///     password: "mytoken".to_string(),
/// };
///
/// let url = inject_credentials(
///     "https://github.com/user/repo.git",
///     &creds
/// ).unwrap();
///
/// assert_eq!(url, "https://myuser:mytoken@github.com/user/repo.git");
/// ```
pub fn inject_credentials(url: &str, creds: &Credentials) -> Result<String> {
	let parsed = url::Url::parse(url).map_err(GitError::from)?;

	if parsed.scheme() != "https" {
		return Err(GitError::not_https(url));
	}

	let mut with_creds = parsed.clone();

	with_creds
		.set_username(&creds.username)
		.map_err(|_| GitError::invalid_url("Failed to set username"))?;

	with_creds
		.set_password(Some(&creds.password))
		.map_err(|_| GitError::invalid_url("Failed to set password"))?;

	Ok(with_creds.to_string())
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::Mutex;
	use std::sync::OnceLock;

	// Mutex to serialize tests that manipulate environment variables
	fn env_lock() -> &'static Mutex<()> {
		static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
		LOCK.get_or_init(|| Mutex::new(()))
	}

	#[test]
	fn test_inject_credentials() {
		let creds = Credentials {
			username: "myuser".to_string(),
			password: "mytoken".to_string(),
		};

		let url =
			inject_credentials("https://github.com/user/repo.git", &creds)
				.unwrap();

		assert!(url.contains("myuser:mytoken@"));
		assert!(url.starts_with("https://"));
		assert!(url.ends_with("github.com/user/repo.git"));
	}

	#[test]
	fn test_inject_credentials_not_https() {
		let creds = Credentials {
			username: "myuser".to_string(),
			password: "mytoken".to_string(),
		};

		let result = inject_credentials("git@github.com:user/repo.git", &creds);
		assert!(result.is_err());
	}

	#[test]
	fn test_read_credentials_missing() {
		let _guard = env_lock().lock().unwrap();

		env::remove_var(GIT_USERNAME_ENV);
		env::remove_var(GIT_PASSWORD_ENV);

		let creds = read_credentials();
		assert!(creds.is_none());
	}

	#[test]
	fn test_read_credentials_present() {
		let _guard = env_lock().lock().unwrap();

		env::remove_var(GIT_USERNAME_ENV);
		env::remove_var(GIT_PASSWORD_ENV);

		env::set_var(GIT_USERNAME_ENV, "testuser");
		env::set_var(GIT_PASSWORD_ENV, "testpass");

		let creds = read_credentials();
		assert!(
			creds.is_some(),
			"Expected Some(creds), got None. ENV vars: {:?}, {:?}",
			env::var(GIT_USERNAME_ENV),
			env::var(GIT_PASSWORD_ENV)
		);
		assert_eq!(creds.unwrap().username, "testuser");

		env::remove_var(GIT_USERNAME_ENV);
		env::remove_var(GIT_PASSWORD_ENV);
	}
}

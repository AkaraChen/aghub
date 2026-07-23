//! First-run `config.yaml` handling for the managed instance.
//!
//! The config lives in CLIProxyAPI's own conventional location
//! (`~/.cli-proxy-api/`), not in aghub's app data: the user keeps a config
//! that works with the stock binary if aghub is removed, and can copy it to
//! a server unchanged. aghub only creates the file when it does not exist;
//! when one exists we never rewrite it here — a missing `remote-management`
//! block is appended textually (preserving the user's content verbatim) and
//! anything else goes through the management API, which does its own
//! persistence.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{GatewayError, Result};

pub const DEFAULT_PORT: u16 = 8317;

#[derive(Debug)]
pub struct BootstrapOutcome {
	pub config_path: PathBuf,
	/// Plaintext management key. Also written to the config file, where
	/// CLIProxyAPI bcrypt-hashes it in place on first start; aghub keeps
	/// the plaintext in the keyring.
	pub management_key: String,
	pub port: u16,
}

pub fn default_config_dir() -> Result<PathBuf> {
	dirs::home_dir()
		.map(|home| home.join(".cli-proxy-api"))
		.ok_or(GatewayError::HomeDirectoryUnavailable)
}

fn generate_key(prefix: &str) -> String {
	format!("{prefix}{}", uuid::Uuid::new_v4().simple())
}

/// Ensure a manageable config exists. `known_key` is the plaintext
/// management key aghub already holds for this instance (keyring), if any.
pub fn ensure_config(
	config_dir: &Path,
	port: u16,
	known_key: Option<&str>,
) -> Result<BootstrapOutcome> {
	let config_path = config_dir.join("config.yaml");
	if !config_path.exists() {
		let management_key = generate_key("");
		let gateway_key = generate_key("sk-aghub-");
		std::fs::create_dir_all(config_dir)?;
		write_config_atomic(
			&config_path,
			&render_initial_config(
				config_dir,
				port,
				&management_key,
				&gateway_key,
			),
			false,
		)?;
		return Ok(BootstrapOutcome {
			config_path,
			management_key,
			port,
		});
	}

	let raw = std::fs::read_to_string(&config_path)?;
	let parsed: serde_yaml::Value =
		serde_yaml::from_str(&raw).map_err(|error| {
			GatewayError::ConfigFile {
				path: config_path.clone(),
				message: format!("existing config is not valid YAML: {error}"),
			}
		})?;

	let file_port = parsed
		.get("port")
		.and_then(serde_yaml::Value::as_u64)
		.and_then(|value| u16::try_from(value).ok())
		.unwrap_or(port);

	let secret_key = parsed
		.get("remote-management")
		.and_then(|block| block.get("secret-key"))
		.and_then(serde_yaml::Value::as_str)
		.unwrap_or_default();

	if !secret_key.is_empty() {
		// Existing management setup. We can only manage it if we already
		// hold the plaintext key (the file may contain a bcrypt hash).
		let management_key =
			known_key.ok_or_else(|| GatewayError::ConfigFile {
				path: config_path.clone(),
				message: "config.yaml already has a management secret-key; \
				          provide that key to let aghub manage this instance"
					.to_string(),
			})?;
		return Ok(BootstrapOutcome {
			config_path,
			management_key: management_key.to_string(),
			port: file_port,
		});
	}

	if parsed.get("remote-management").is_some() {
		// A block exists but management is disabled (empty key). Editing
		// inside the user's block risks clobbering their formatting; ask
		// them to decide instead of silently enabling remote management.
		return Err(GatewayError::ConfigFile {
			path: config_path,
			message: "config.yaml has a remote-management block without a \
			          secret-key; set one (and re-add the instance with it) \
			          or remove the block so aghub can append its own"
				.to_string(),
		});
	}

	// No management block at all: append one, leaving the user's content
	// byte-for-byte untouched.
	let management_key = generate_key("");
	let mut appended = raw;
	if !appended.ends_with('\n') {
		appended.push('\n');
	}
	appended.push_str(&render_management_block(&management_key));
	write_config_atomic(&config_path, &appended, true)?;
	Ok(BootstrapOutcome {
		config_path,
		management_key,
		port: file_port,
	})
}

fn write_config_atomic(
	path: &Path,
	content: &str,
	replace: bool,
) -> Result<()> {
	let target = match std::fs::symlink_metadata(path) {
		Ok(metadata) if metadata.file_type().is_symlink() => {
			match std::fs::canonicalize(path) {
				Ok(target) => target,
				Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
					let target = std::fs::read_link(path)?;
					if target.is_absolute() {
						target
					} else {
						path.parent()
							.unwrap_or_else(|| Path::new("."))
							.join(target)
					}
				}
				Err(error) => return Err(error.into()),
			}
		}
		Ok(_) => path.to_path_buf(),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
			path.to_path_buf()
		}
		Err(error) => return Err(error.into()),
	};
	let parent = target.parent().ok_or_else(|| GatewayError::ConfigFile {
		path: target.clone(),
		message: "config path has no parent directory".to_string(),
	})?;
	std::fs::create_dir_all(parent)?;
	let permissions = match target.metadata() {
		Ok(metadata) => Some(metadata.permissions()),
		Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
		Err(error) => return Err(error.into()),
	};
	let mut temporary = tempfile::Builder::new()
		.prefix(".config.")
		.suffix(".yaml.tmp")
		.tempfile_in(parent)?;
	temporary.write_all(content.as_bytes())?;
	if let Some(permissions) = permissions {
		temporary.as_file().set_permissions(permissions)?;
	} else {
		set_private_permissions(temporary.as_file())?;
	}
	temporary.as_file().sync_all()?;
	if replace {
		temporary.persist(&target).map_err(|error| error.error)?;
	} else {
		temporary
			.persist_noclobber(&target)
			.map_err(|error| error.error)?;
	}
	#[cfg(unix)]
	std::fs::File::open(parent)?.sync_all()?;
	Ok(())
}

#[cfg(unix)]
fn set_private_permissions(file: &std::fs::File) -> std::io::Result<()> {
	use std::os::unix::fs::PermissionsExt;

	file.set_permissions(std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_permissions(_file: &std::fs::File) -> std::io::Result<()> {
	Ok(())
}

fn render_initial_config(
	config_dir: &Path,
	port: u16,
	management_key: &str,
	gateway_key: &str,
) -> String {
	// auth-dir sits next to the config so a relocated dir (tests, custom
	// setups) stays self-contained. Forward slashes keep the YAML
	// double-quoted string free of escape sequences on Windows.
	let auth_dir = config_dir.to_string_lossy().replace('\\', "/");
	format!(
		"# Generated by aghub. CLIProxyAPI hot-reloads edits to this file.\n\
		 host: \"127.0.0.1\"\n\
		 port: {port}\n\
		 auth-dir: \"{auth_dir}\"\n\
		 api-keys:\n\
		 \x20 - \"{gateway_key}\"\n\
		 {block}",
		block = render_management_block(management_key)
	)
}

fn render_management_block(management_key: &str) -> String {
	format!(
		"remote-management:\n\
		 \x20 allow-remote: false\n\
		 \x20 secret-key: \"{management_key}\"\n\
		 \x20 disable-control-panel: true\n"
	)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn fresh_config_is_generated_with_keys() {
		let dir = tempfile::tempdir().expect("tempdir");
		let outcome =
			ensure_config(dir.path(), DEFAULT_PORT, None).expect("bootstrap");
		let raw = std::fs::read_to_string(outcome.config_path)
			.expect("config written");
		assert!(raw.contains("port: 8317"));
		assert!(raw.contains("disable-control-panel: true"));
		assert!(raw.contains(&outcome.management_key));
		assert!(raw.contains("sk-aghub-"));
		let parsed: serde_yaml::Value =
			serde_yaml::from_str(&raw).expect("valid yaml");
		assert_eq!(
			parsed["remote-management"]["allow-remote"],
			serde_yaml::Value::Bool(false)
		);
	}

	#[cfg(unix)]
	#[test]
	fn fresh_config_is_private() {
		use std::os::unix::fs::PermissionsExt;

		let dir = tempfile::tempdir().expect("tempdir");
		let outcome =
			ensure_config(dir.path(), DEFAULT_PORT, None).expect("bootstrap");
		let mode = std::fs::metadata(outcome.config_path)
			.expect("config metadata")
			.permissions()
			.mode() & 0o777;

		assert_eq!(mode, 0o600);
	}

	#[test]
	fn existing_config_without_block_gets_appended_untouched() {
		let dir = tempfile::tempdir().expect("tempdir");
		let original = "# my config\nport: 9000\nauth-dir: \"~/x\"\n";
		std::fs::write(dir.path().join("config.yaml"), original)
			.expect("seed config");

		let outcome =
			ensure_config(dir.path(), DEFAULT_PORT, None).expect("bootstrap");
		assert_eq!(outcome.port, 9000);
		let raw = std::fs::read_to_string(dir.path().join("config.yaml"))
			.expect("config");
		assert!(raw.starts_with(original), "user content must be untouched");
		assert!(raw.contains("secret-key"));
	}

	#[cfg(unix)]
	#[test]
	fn existing_symlink_is_preserved_with_target_permissions() {
		use std::os::unix::fs::{symlink, PermissionsExt};

		let dir = tempfile::tempdir().expect("tempdir");
		let config_dir = dir.path().join("config");
		std::fs::create_dir(&config_dir).expect("config dir");
		let target = dir.path().join("dotfiles-config.yaml");
		std::fs::write(&target, "port: 9000\n").expect("target");
		std::fs::set_permissions(
			&target,
			std::fs::Permissions::from_mode(0o640),
		)
		.expect("permissions");
		let config_path = config_dir.join("config.yaml");
		symlink(&target, &config_path).expect("symlink");

		ensure_config(&config_dir, DEFAULT_PORT, None).expect("bootstrap");

		assert!(std::fs::symlink_metadata(&config_path)
			.expect("link metadata")
			.file_type()
			.is_symlink());
		let mode = std::fs::metadata(&target)
			.expect("target metadata")
			.permissions()
			.mode() & 0o777;
		assert_eq!(mode, 0o640);
		assert!(std::fs::read_to_string(target)
			.expect("target content")
			.contains("remote-management"));
	}

	#[cfg(unix)]
	#[test]
	fn dangling_symlink_target_is_created_in_place() {
		use std::os::unix::fs::symlink;

		let dir = tempfile::tempdir().expect("tempdir");
		let config_dir = dir.path().join("config");
		std::fs::create_dir(&config_dir).expect("config dir");
		let target = dir.path().join("dotfiles/config.yaml");
		let config_path = config_dir.join("config.yaml");
		symlink(&target, &config_path).expect("symlink");

		ensure_config(&config_dir, DEFAULT_PORT, None).expect("bootstrap");

		assert!(std::fs::symlink_metadata(&config_path)
			.expect("link metadata")
			.file_type()
			.is_symlink());
		assert!(std::fs::read_to_string(target)
			.expect("target content")
			.contains("remote-management"));
	}

	#[test]
	fn existing_secret_key_requires_known_key() {
		let dir = tempfile::tempdir().expect("tempdir");
		std::fs::write(
			dir.path().join("config.yaml"),
			"port: 8317\nremote-management:\n  secret-key: \"$2a$hash\"\n",
		)
		.expect("seed config");

		assert!(matches!(
			ensure_config(dir.path(), DEFAULT_PORT, None),
			Err(GatewayError::ConfigFile { .. })
		));

		let outcome = ensure_config(dir.path(), DEFAULT_PORT, Some("plain"))
			.expect("bootstrap with known key");
		assert_eq!(outcome.management_key, "plain");
	}
}

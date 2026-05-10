use std::fs;
use std::path::Path;

fn main() {
	// Bake VITE_POSTHOG_KEY / VITE_POSTHOG_HOST from the desktop crate's
	// .env into the binary so option_env!() in commands::posthog can
	// read them. Vite already does this for the webview side; this
	// closes the loop on the Rust side without requiring developers to
	// export the env vars manually before `cargo build`. Falls back to
	// any value already in the process env so CI can override.
	let env_path = Path::new("../.env");
	if env_path.exists() {
		println!("cargo:rerun-if-changed={}", env_path.display());
		if let Ok(contents) = fs::read_to_string(env_path) {
			for line in contents.lines() {
				let trimmed = line.trim();
				if trimmed.is_empty() || trimmed.starts_with('#') {
					continue;
				}
				let Some((key, value)) = trimmed.split_once('=') else {
					continue;
				};
				let key = key.trim();
				let value = value.trim().trim_matches('"').trim_matches('\'');
				// Only forward VITE_-prefixed entries (those are the ones
				// shared between the webview and Rust by convention).
				if !key.starts_with("VITE_") {
					continue;
				}
				if std::env::var_os(key).is_none() {
					println!("cargo:rustc-env={key}={value}");
				}
			}
		}
	}

	println!("cargo:rerun-if-env-changed=VITE_POSTHOG_KEY");
	println!("cargo:rerun-if-env-changed=VITE_POSTHOG_HOST");

	tauri_build::build()
}

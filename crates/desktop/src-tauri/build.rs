use std::path::Path;

fn main() {
	// Bake POSTHOG_KEY / POSTHOG_HOST from the desktop crate's
	// .env into the binary so option_env!() in commands::posthog can
	// read them. The webview receives the same values through a Tauri
	// command, so these do not need VITE_ exposure. Falls back to any
	// value already in the process env so CI can override.
	let env_path = Path::new("../.env");
	if env_path.exists() {
		println!("cargo:rerun-if-changed={}", env_path.display());
		let _ = dotenvy::from_path(env_path);
	}

	for key in ["POSTHOG_KEY", "POSTHOG_HOST"] {
		println!("cargo:rerun-if-env-changed={key}");
		if let Ok(value) = std::env::var(key) {
			println!("cargo:rustc-env={key}={value}");
		}
	}

	tauri_build::build()
}

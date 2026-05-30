use std::path::Path;

fn main() {
	// Load POSTHOG_KEY / POSTHOG_HOST from the desktop crate's .env so
	// option_env!() in commands::posthog can embed them. The webview gets
	// the same values through a Tauri command, not Vite env exposure.
	let env_path = Path::new("../.env");
	if env_path.exists() {
		println!("cargo:rerun-if-changed={}", env_path.display());
		let _ = dotenvy::from_path(env_path);
	}

	tauri_build::build()
}

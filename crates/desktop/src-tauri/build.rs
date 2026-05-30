use std::fs;
use std::path::Path;

fn main() {
	// Bake desktop app config env into the Rust binary so the synchronous
	// `get_app_config` command can hand one type-safe config object to the
	// webview before React renders. The names intentionally do not use the
	// Vite-only `VITE_` prefix: frontend code reads them through app config,
	// not `import.meta.env`.
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
				if !matches!(key, "POSTHOG_KEY" | "POSTHOG_HOST") {
					continue;
				}
				if std::env::var_os(key).is_none() {
					println!("cargo:rustc-env={key}={value}");
				}
			}
		}
	}

	println!("cargo:rerun-if-env-changed=POSTHOG_KEY");
	println!("cargo:rerun-if-env-changed=POSTHOG_HOST");

	tauri_build::build()
}

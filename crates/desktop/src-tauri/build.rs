use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;

// Download ccusage's prebuilt npm binary and stage it as the Tauri sidecar.
const CCUSAGE_VERSION: &str = "20.0.6";

fn ccusage_platform(triple: &str) -> Option<&'static str> {
	Some(match triple {
		"aarch64-apple-darwin" => "darwin-arm64",
		"x86_64-apple-darwin" => "darwin-x64",
		"aarch64-unknown-linux-gnu" => "linux-arm64",
		"x86_64-unknown-linux-gnu" => "linux-x64",
		"aarch64-pc-windows-msvc" => "win32-arm64",
		"x86_64-pc-windows-msvc" => "win32-x64",
		_ => return None,
	})
}

fn fetch_ccusage_sidecar() {
	let triple = env::var("TARGET").expect("cargo sets TARGET");
	let platform = ccusage_platform(&triple).unwrap_or_else(|| {
		panic!(
			"no ccusage prebuilt binary for target triple '{triple}'. \
			 Add the mapping in build.rs if a package now exists."
		)
	});

	let is_windows = triple.contains("windows");
	let ext = if is_windows { ".exe" } else { "" };

	let binaries_dir =
		PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("binaries");
	let dest = binaries_dir.join(format!("ccusage-{triple}{ext}"));

	// Filename is version-independent, so bumping CCUSAGE_VERSION needs binaries/ cleared.
	if dest.exists() {
		return;
	}

	fs::create_dir_all(&binaries_dir).expect("create binaries dir");

	let pkg = format!("@ccusage/ccusage-{platform}");
	let url = format!(
		"https://registry.npmjs.org/{pkg}/-/ccusage-{platform}-{CCUSAGE_VERSION}.tgz"
	);

	let resp = ureq::get(&url)
		.call()
		.unwrap_or_else(|e| panic!("download {url} failed: {e}"));
	let mut tarball = Vec::new();
	resp.into_reader()
		.read_to_end(&mut tarball)
		.expect("read ccusage tarball");

	// npm tarball layout: package/bin/ccusage(.exe).
	let member = format!("package/bin/ccusage{ext}");
	let mut archive = tar::Archive::new(GzDecoder::new(&tarball[..]));
	let mut staged = false;
	for entry in archive.entries().expect("read tar entries") {
		let mut entry = entry.expect("read tar entry");
		let path = entry.path().expect("tar entry path");
		if path.to_string_lossy().replace('\\', "/") != member {
			continue;
		}
		let tmp = dest.with_extension("tmp");
		io::copy(
			&mut entry,
			&mut fs::File::create(&tmp).expect("create temp sidecar"),
		)
		.expect("write sidecar");
		fs::rename(&tmp, &dest).expect("rename sidecar into place");
		staged = true;
		break;
	}
	if !staged {
		panic!("member not found in tarball: {member}");
	}

	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		fs::set_permissions(&dest, fs::Permissions::from_mode(0o755))
			.expect("chmod sidecar");
	}
}

fn main() {
	// Load POSTHOG_KEY / POSTHOG_HOST from the desktop crate's .env so
	// option_env!() in commands::posthog can embed them. The webview gets
	// the same values through a Tauri command, not Vite env exposure.
	let env_path = Path::new("../.env");
	println!("cargo:rerun-if-changed={}", env_path.display());
	if env_path.exists() {
		if let Err(error) = dotenvy::from_path(env_path) {
			println!(
				"cargo:warning=Failed to load {}: {}",
				env_path.display(),
				error
			);
		}
	}

	fetch_ccusage_sidecar();
	tauri_build::build();
}

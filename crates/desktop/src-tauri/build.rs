use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;

use flate2::read::GzDecoder;

// Download ccusage's prebuilt npm binary and stage it as the Tauri sidecar.
const CCUSAGE_VERSION: &str = "20.0.18";

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
	let is_windows = triple.contains("windows");
	let ext = if is_windows { ".exe" } else { "" };

	let binaries_dir =
		PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("binaries");
	let dest = binaries_dir.join(format!("ccusage-{triple}{ext}"));
	let stamp = binaries_dir.join(format!(".ccusage-{triple}.version"));

	// Tauri resolves the sidecar by its fixed `ccusage-<triple>` name, so the
	// filename can't carry the version. Track the staged version in a sibling
	// stamp file and re-fetch whenever CCUSAGE_VERSION changes.
	if dest.exists()
		&& fs::read_to_string(&stamp).ok().as_deref() == Some(CCUSAGE_VERSION)
	{
		return;
	}

	// Offline / CLI-only escape hatch. A bare `cargo build --workspace` compiles
	// this crate (and runs build.rs) even for contributors who only touch the
	// CLI/core, which would otherwise force a network fetch. Checked before the
	// platform-triple lookup below so even an unmapped target can stage a
	// placeholder instead of panicking. With AGHUB_SKIP_SIDECAR set, stage an
	// empty placeholder so tauri-build's externalBin existence check still passes
	// without hitting the network. The
	// placeholder is NOT runnable — never set this for a real bundle (`tauri
	// build` does not), and we leave the version stamp unwritten so a later
	// online build re-fetches the real binary.
	if env::var_os("AGHUB_SKIP_SIDECAR").is_some() {
		fs::create_dir_all(&binaries_dir).expect("create binaries dir");
		if !dest.exists() {
			fs::write(&dest, b"").expect("write sidecar placeholder");
			#[cfg(unix)]
			{
				use std::os::unix::fs::PermissionsExt;
				fs::set_permissions(&dest, fs::Permissions::from_mode(0o755))
					.expect("chmod sidecar placeholder");
			}
		}
		println!(
			"cargo:warning=AGHUB_SKIP_SIDECAR set; staged a non-functional \
			 ccusage placeholder (offline build)"
		);
		return;
	}

	fs::create_dir_all(&binaries_dir).expect("create binaries dir");

	// Only the real network fetch needs the npm platform package, so the triple
	// mapping is resolved here rather than up front: an unsupported triple now
	// fails only when a sidecar is actually required, leaving the stamp short-
	// circuit and AGHUB_SKIP_SIDECAR hatch above reachable on any target.
	let platform = ccusage_platform(&triple).unwrap_or_else(|| {
		panic!(
			"no ccusage prebuilt binary for target triple '{triple}'. \
			 Add the mapping in build.rs if a package now exists."
		)
	});

	// A configured agent gives the otherwise-unbounded registry/tarball fetches
	// connect/read timeouts, so an unreachable or stalled registry fails the
	// build instead of hanging it forever (ureq sets no default timeout).
	let agent: ureq::Agent = ureq::Agent::config_builder()
		.timeout_connect(Some(Duration::from_secs(30)))
		.timeout_recv_response(Some(Duration::from_secs(120)))
		.timeout_recv_body(Some(Duration::from_secs(120)))
		.build()
		.into();

	// Read the tarball URL and Subresource Integrity hash from the registry
	// rather than hardcoding either. The hash ships with the package metadata,
	// so a bumped CCUSAGE_VERSION verifies against its own published integrity.
	let pkg = format!("@ccusage/ccusage-{platform}");
	let meta_url = format!("https://registry.npmjs.org/{pkg}");
	let meta_resp = agent
		.get(&meta_url)
		.header("Accept", "application/vnd.npm.install-v1+json")
		.call()
		.unwrap_or_else(|e| panic!("fetch {meta_url} failed: {e}"));
	let mut meta_bytes = Vec::new();
	meta_resp
		.into_body()
		.into_reader()
		.read_to_end(&mut meta_bytes)
		.expect("read ccusage registry metadata");
	let meta: serde_json::Value = serde_json::from_slice(&meta_bytes)
		.expect("parse ccusage registry metadata");

	let dist = &meta["versions"][CCUSAGE_VERSION]["dist"];
	let url = dist["tarball"].as_str().unwrap_or_else(|| {
		panic!("registry has no tarball url for {pkg}@{CCUSAGE_VERSION}")
	});
	let integrity = dist["integrity"].as_str().unwrap_or_else(|| {
		panic!("registry has no integrity for {pkg}@{CCUSAGE_VERSION}")
	});

	let resp = agent
		.get(url)
		.call()
		.unwrap_or_else(|e| panic!("download {url} failed: {e}"));
	let mut tarball = Vec::new();
	resp.into_body()
		.into_reader()
		.read_to_end(&mut tarball)
		.expect("read ccusage tarball");

	verify_tarball_integrity(&pkg, &tarball, integrity);

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
		// Windows `rename` fails if the destination exists (a prior version or an
		// AGHUB_SKIP_SIDECAR placeholder), so a re-fetch would panic here; drop
		// the stale sidecar first. Build-time staging is single-threaded, so the
		// lost atomicity on unix is harmless.
		if dest.exists() {
			fs::remove_file(&dest).expect("remove stale sidecar");
		}
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

	fs::write(&stamp, CCUSAGE_VERSION).expect("write ccusage version stamp");
}

// Check the tarball against the registry's `sha512-<base64>` integrity string,
// so a tampered or truncated download fails the build instead of shipping a
// bad sidecar.
fn verify_tarball_integrity(pkg: &str, tarball: &[u8], integrity: &str) {
	use base64::Engine as _;
	use sha2::{Digest, Sha512};

	let expected =
		integrity
			.split_whitespace()
			.find(|hash| hash.starts_with("sha512-"))
			.unwrap_or_else(|| {
				panic!("{pkg}: registry integrity carries no sha512 hash: {integrity}")
			});
	let actual = format!(
		"sha512-{}",
		base64::engine::general_purpose::STANDARD
			.encode(Sha512::digest(tarball))
	);
	if actual != expected {
		panic!(
			"{pkg}: ccusage tarball integrity mismatch \
			 (expected {expected}, computed {actual})"
		);
	}
}

fn main() {
	// Load POSTHOG_KEY / POSTHOG_HOST from the desktop crate's .env so
	// option_env!() in commands::posthog can embed them. The webview gets
	// the same values through a Tauri command, not Vite env exposure.
	println!("cargo:rerun-if-env-changed=AGHUB_SKIP_SIDECAR");
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

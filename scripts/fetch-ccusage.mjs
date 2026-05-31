#!/usr/bin/env node
// Fetch the prebuilt ccusage binary for the current Rust target triple and
// stage it as a Tauri sidecar at crates/desktop/src-tauri/binaries/ccusage-<triple>.
//
// ccusage ships per-platform native binaries via npm (@ccusage/ccusage-<platform>);
// each package contains a standalone executable at bin/ccusage (no node needed).
// We grab only the binary for the host triple — cross-platform CI runners each
// stage their own. Run automatically from tauri's beforeBuildCommand.
//
// Zero npm dependencies: download with built-in fetch, unpack with the system
// `tar` (bsdtar on macOS/Windows, GNU tar on Linux — both read gzip from stdin).

import { spawn, execFileSync } from "node:child_process";
import { chmod, mkdir, access, rename, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const CCUSAGE_VERSION = "20.0.6";

// Rust target triple -> npm platform package suffix.
const TRIPLE_TO_PLATFORM = {
	"aarch64-apple-darwin": "darwin-arm64",
	"x86_64-apple-darwin": "darwin-x64",
	"aarch64-unknown-linux-gnu": "linux-arm64",
	"x86_64-unknown-linux-gnu": "linux-x64",
	"aarch64-pc-windows-msvc": "win32-arm64",
	"x86_64-pc-windows-msvc": "win32-x64",
};

function hostTriple() {
	const out = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
	const line = out.split("\n").find((l) => l.startsWith("host: "));
	if (!line)
		throw new Error("could not determine host triple from `rustc -Vv`");
	return line.slice("host: ".length).trim();
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

// Pipe the gzipped tarball through `tar`, extracting a single member to a file.
// `tar -xzO` writes the member to stdout; we pipeline that into destPath and
// await both the process exit and the file write completing.
async function extractMemberToFile(tarballBytes, member, destPath) {
	const tar = spawn("tar", ["-xzO", "-f", "-", member], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	const exited = new Promise((resolve, reject) => {
		tar.on("error", reject);
		tar.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)),
		);
	});
	tar.stdin.end(tarballBytes);
	await Promise.all([
		pipeline(tar.stdout, createWriteStream(destPath)),
		exited,
	]);
	if ((await stat(destPath)).size === 0) {
		throw new Error(`member not found in tarball: ${member}`);
	}
}

async function main() {
	const triple = process.env.CCUSAGE_TARGET_TRIPLE ?? hostTriple();
	const platform = TRIPLE_TO_PLATFORM[triple];
	if (!platform) {
		throw new Error(
			`no ccusage prebuilt binary for target triple '${triple}'. ` +
				`Known: ${Object.keys(TRIPLE_TO_PLATFORM).join(", ")}`,
		);
	}

	const isWindows = triple.includes("windows");
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const binariesDir = join(
		scriptDir,
		"..",
		"crates",
		"desktop",
		"src-tauri",
		"binaries",
	);
	const ext = isWindows ? ".exe" : "";
	const dest = join(binariesDir, `ccusage-${triple}${ext}`);

	if (await exists(dest)) {
		console.log(`[fetch-ccusage] already present: ${dest}`);
		return;
	}

	await mkdir(binariesDir, { recursive: true });

	const pkg = `@ccusage/ccusage-${platform}`;
	const tarballUrl = `https://registry.npmjs.org/${pkg}/-/ccusage-${platform}-${CCUSAGE_VERSION}.tgz`;
	console.log(`[fetch-ccusage] downloading ${pkg}@${CCUSAGE_VERSION}`);

	const res = await fetch(tarballUrl);
	if (!res.ok) {
		throw new Error(
			`download failed: ${res.status} ${res.statusText} (${tarballUrl})`,
		);
	}
	const tarballBytes = Buffer.from(await res.arrayBuffer());

	// npm tarball layout: package/bin/ccusage(.exe).
	const member = `package/bin/ccusage${ext}`;
	const tmp = `${dest}.tmp`;
	await extractMemberToFile(tarballBytes, member, tmp);
	await rename(tmp, dest);
	if (!isWindows) await chmod(dest, 0o755);
	console.log(`[fetch-ccusage] staged sidecar: ${dest}`);
}

main().catch((err) => {
	console.error(`[fetch-ccusage] ${err.message}`);
	process.exit(1);
});

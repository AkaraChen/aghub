import {
	copyFile,
	mkdir,
	readFile,
	readdir,
	writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

interface UpdaterPlatform {
	signature: string;
	url: string;
}

export interface UpdaterManifest {
	version: string;
	notes: string;
	pub_date: string;
	platforms: Record<string, UpdaterPlatform>;
}

interface UpdaterManifestInput {
	version: string;
	tag: string;
	repository: string;
	publishedAt: string;
	notes: string;
	assetNames: ReadonlySet<string>;
	signatures: ReadonlyMap<string, string>;
}

interface PrepareReleaseAssetsInput {
	source: string;
	output: string;
	version: string;
	tag: string;
	repository: string;
	publishedAt: string;
	notesPath: string;
}

interface UpdaterAsset {
	platforms: readonly string[];
	assetName: string;
	signatureName: string;
}

const scriptPath = fileURLToPath(import.meta.url);

export function normalizeReleaseAssetName(
	sourcePath: string,
	version: string,
): string {
	const name = basename(sourcePath);
	if (name !== "aghub.app.tar.gz" && name !== "aghub.app.tar.gz.sig") {
		return name;
	}
	const suffix = name.endsWith(".sig") ? ".sig" : "";
	if (sourcePath.includes("aarch64-apple-darwin")) {
		return `aghub_${version}_aarch64.app.tar.gz${suffix}`;
	}
	if (sourcePath.includes("x86_64-apple-darwin")) {
		return `aghub_${version}_x64.app.tar.gz${suffix}`;
	}
	throw new Error(`cannot determine macOS architecture for ${sourcePath}`);
}

function updaterAssets(version: string): UpdaterAsset[] {
	return [
		{
			platforms: ["darwin-aarch64", "darwin-aarch64-app"],
			assetName: `aghub_${version}_aarch64.app.tar.gz`,
			signatureName: `aghub_${version}_aarch64.app.tar.gz.sig`,
		},
		{
			platforms: ["darwin-x86_64", "darwin-x86_64-app"],
			assetName: `aghub_${version}_x64.app.tar.gz`,
			signatureName: `aghub_${version}_x64.app.tar.gz.sig`,
		},
		{
			platforms: ["linux-x86_64", "linux-x86_64-appimage"],
			assetName: `aghub_${version}_amd64.AppImage`,
			signatureName: `aghub_${version}_amd64.AppImage.sig`,
		},
		{
			platforms: ["windows-x86_64", "windows-x86_64-nsis"],
			assetName: `aghub_${version}_x64-setup.exe`,
			signatureName: `aghub_${version}_x64-setup.exe.sig`,
		},
	];
}

export function createUpdaterManifest(
	input: UpdaterManifestInput,
): UpdaterManifest {
	const platforms: Record<string, UpdaterPlatform> = {};
	const encodedTag = encodeURIComponent(input.tag);
	for (const updaterAsset of updaterAssets(input.version)) {
		const primaryPlatform = updaterAsset.platforms[0]!;
		if (!input.assetNames.has(updaterAsset.assetName)) {
			throw new Error(
				`${primaryPlatform} updater asset ${updaterAsset.assetName} is missing`,
			);
		}
		const signature = input.signatures
			.get(updaterAsset.signatureName)
			?.trim();
		if (!signature) {
			throw new Error(
				`${primaryPlatform} updater signature ${updaterAsset.signatureName} is missing`,
			);
		}
		const url =
			`https://github.com/${input.repository}/releases/download/` +
			`${encodedTag}/${encodeURIComponent(updaterAsset.assetName)}`;
		for (const platform of updaterAsset.platforms) {
			platforms[platform] = { signature, url };
		}
	}
	return {
		version: input.version,
		notes: input.notes,
		pub_date: input.publishedAt,
		platforms,
	};
}

async function listFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const path = join(root, entry.name);
			return entry.isDirectory() ? listFiles(path) : [path];
		}),
	);
	return files.flat().sort();
}

export async function prepareReleaseAssets(
	input: PrepareReleaseAssetsInput,
): Promise<void> {
	await mkdir(input.output, { recursive: true });
	const existing = await readdir(input.output);
	if (existing.length > 0) {
		throw new Error(`${input.output} must be empty`);
	}

	const assetNames = new Set<string>();
	const signatures = new Map<string, string>();
	for (const sourcePath of await listFiles(input.source)) {
		const name = normalizeReleaseAssetName(sourcePath, input.version);
		if (assetNames.has(name)) {
			throw new Error(`duplicate release asset ${name}`);
		}
		assetNames.add(name);
		await copyFile(sourcePath, join(input.output, name));
		if (name.endsWith(".sig")) {
			signatures.set(name, await readFile(sourcePath, "utf8"));
		}
	}

	const notes = await readFile(input.notesPath, "utf8");
	if (notes.trim().length === 0) {
		throw new Error("release notes must not be empty");
	}
	const updaterManifest = createUpdaterManifest({
		version: input.version,
		tag: input.tag,
		repository: input.repository,
		publishedAt: input.publishedAt,
		notes,
		assetNames,
		signatures,
	});
	await writeFile(
		join(input.output, "latest.json"),
		`${JSON.stringify(updaterManifest, null, 2)}\n`,
	);
}

function readOption(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function requireOption(args: string[], name: string): string {
	const value = readOption(args, name);
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}

async function runCli(): Promise<void> {
	const args = process.argv.slice(2);
	await prepareReleaseAssets({
		source: resolve(process.cwd(), requireOption(args, "--source")),
		output: resolve(process.cwd(), requireOption(args, "--output")),
		version: requireOption(args, "--version").replace(/^v/, ""),
		tag: requireOption(args, "--tag"),
		repository: requireOption(args, "--repository"),
		publishedAt: requireOption(args, "--published-at"),
		notesPath: resolve(process.cwd(), requireOption(args, "--notes")),
	});
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
	void runCli().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

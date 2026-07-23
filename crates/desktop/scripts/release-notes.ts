import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { compareVersions } from "compare-versions";
import { parse } from "yaml";

export const RELEASE_LOCALES = ["en", "zh-Hans", "zh-Hant"] as const;

export type ReleaseLocale = (typeof RELEASE_LOCALES)[number];
export type ReleaseChannel = "stable" | "beta";
export type ReleaseIcon = "sparkles" | "puzzle" | "shield";
export type LocalizedReleaseText = Record<ReleaseLocale, string>;

export interface ReleaseHighlight {
	id: string;
	icon: ReleaseIcon;
	title: LocalizedReleaseText;
	description: LocalizedReleaseText;
}

export interface ReleaseKnownIssue {
	id: string;
	title: LocalizedReleaseText;
	description: LocalizedReleaseText;
}

export interface ReleaseManifest {
	version: string;
	channel: ReleaseChannel;
	title: LocalizedReleaseText;
	summary: LocalizedReleaseText;
	highlights: ReleaseHighlight[];
	knownIssues: ReleaseKnownIssue[];
}

interface AppReleaseCatalog {
	schemaVersion: 1;
	releases: ReleaseManifest[];
}

const LOCALE_HEADINGS: Record<
	ReleaseLocale,
	{ section: string; highlights: string; knownIssues: string }
> = {
	en: {
		section: "English",
		highlights: "Highlights",
		knownIssues: "Known issues",
	},
	"zh-Hans": {
		section: "简体中文",
		highlights: "版本亮点",
		knownIssues: "已知问题",
	},
	"zh-Hant": {
		section: "繁體中文",
		highlights: "版本亮點",
		knownIssues: "已知問題",
	},
};

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = resolve(dirname(scriptPath), "..");
const repositoryRoot = resolve(desktopRoot, "../..");
const manifestsDirectory = resolve(repositoryRoot, "release-notes");
const appCatalogPath = resolve(desktopRoot, "src/generated/release-notes.json");
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[\dA-Z.-]+)?(?:\+[\dA-Z.-]+)?$/i;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHANNELS = new Set<ReleaseChannel>(["stable", "beta"]);
const ICONS = new Set<ReleaseIcon>(["sparkles", "puzzle", "shield"]);

function expectRecord(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function expectKeys(
	record: Record<string, unknown>,
	required: readonly string[],
	path: string,
): void {
	const requiredKeys = new Set(required);
	for (const key of required) {
		if (!(key in record)) {
			throw new Error(`${path}.${key} is required`);
		}
	}
	for (const key of Object.keys(record)) {
		if (!requiredKeys.has(key)) {
			throw new Error(`${path}.${key} is not supported`);
		}
	}
}

function expectString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new TypeError(`${path} must be a non-empty string`);
	}
	return value.trim();
}

function expectArray(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new TypeError(`${path} must be an array`);
	}
	return value;
}

function parseLocalizedText(
	value: unknown,
	path: string,
): LocalizedReleaseText {
	const record = expectRecord(value, path);
	expectKeys(record, RELEASE_LOCALES, path);
	return {
		en: expectString(record.en, `${path}.en`),
		"zh-Hans": expectString(record["zh-Hans"], `${path}.zh-Hans`),
		"zh-Hant": expectString(record["zh-Hant"], `${path}.zh-Hant`),
	};
}

function parseId(value: unknown, path: string): string {
	const id = expectString(value, path);
	if (!ID_PATTERN.test(id)) {
		throw new Error(`${path} must use lowercase kebab-case`);
	}
	return id;
}

function parseIcon(value: unknown, path: string): ReleaseIcon {
	const icon = expectString(value, path);
	if (!ICONS.has(icon as ReleaseIcon)) {
		throw new Error(`${path} must be one of ${[...ICONS].join(", ")}`);
	}
	return icon as ReleaseIcon;
}

function parseHighlights(value: unknown): ReleaseHighlight[] {
	const ids = new Set<string>();
	return expectArray(value, "highlights").map((item, index) => {
		const path = `highlights[${index}]`;
		const record = expectRecord(item, path);
		expectKeys(record, ["id", "icon", "title", "description"], path);
		const id = parseId(record.id, `${path}.id`);
		if (ids.has(id)) {
			throw new Error(`${path}.id duplicates ${id}`);
		}
		ids.add(id);
		return {
			id,
			icon: parseIcon(record.icon, `${path}.icon`),
			title: parseLocalizedText(record.title, `${path}.title`),
			description: parseLocalizedText(
				record.description,
				`${path}.description`,
			),
		};
	});
}

function parseKnownIssues(value: unknown): ReleaseKnownIssue[] {
	const ids = new Set<string>();
	return expectArray(value, "knownIssues").map((item, index) => {
		const path = `knownIssues[${index}]`;
		const record = expectRecord(item, path);
		expectKeys(record, ["id", "title", "description"], path);
		const id = parseId(record.id, `${path}.id`);
		if (ids.has(id)) {
			throw new Error(`${path}.id duplicates ${id}`);
		}
		ids.add(id);
		return {
			id,
			title: parseLocalizedText(record.title, `${path}.title`),
			description: parseLocalizedText(
				record.description,
				`${path}.description`,
			),
		};
	});
}

export function parseReleaseManifest(
	source: string,
	sourceName: string,
): ReleaseManifest {
	const parsed = parse(source) as unknown;
	const record = expectRecord(parsed, sourceName);
	expectKeys(
		record,
		["version", "channel", "title", "summary", "highlights", "knownIssues"],
		sourceName,
	);

	const version = expectString(record.version, `${sourceName}.version`);
	if (!VERSION_PATTERN.test(version)) {
		throw new Error(`${sourceName}.version must be valid SemVer`);
	}
	if (basename(sourceName) !== `v${version}.yml`) {
		throw new Error(`${sourceName} must be named v${version}.yml`);
	}

	const channel = expectString(
		record.channel,
		`${sourceName}.channel`,
	) as ReleaseChannel;
	if (!CHANNELS.has(channel)) {
		throw new Error(`${sourceName}.channel must be stable or beta`);
	}
	const isPrerelease = version.includes("-");
	if ((channel === "beta") !== isPrerelease) {
		throw new Error(
			`${sourceName}.channel must match the version prerelease state`,
		);
	}

	return {
		version,
		channel,
		title: parseLocalizedText(record.title, `${sourceName}.title`),
		summary: parseLocalizedText(record.summary, `${sourceName}.summary`),
		highlights: parseHighlights(record.highlights),
		knownIssues: parseKnownIssues(record.knownIssues),
	};
}

export function serializeAppCatalog(
	manifests: readonly ReleaseManifest[],
): string {
	const catalog: AppReleaseCatalog = {
		schemaVersion: 1,
		releases: [...manifests].sort((left, right) =>
			compareVersions(right.version, left.version),
		),
	};
	return `${JSON.stringify(catalog, null, "\t")}\n`;
}

function renderLocaleSection(
	manifest: ReleaseManifest,
	locale: ReleaseLocale,
): string {
	const headings = LOCALE_HEADINGS[locale];
	const lines = [
		`## ${headings.section}`,
		"",
		`### ${manifest.title[locale]}`,
		"",
		manifest.summary[locale],
	];
	if (manifest.highlights.length > 0) {
		lines.push("", `#### ${headings.highlights}`, "");
		for (const highlight of manifest.highlights) {
			lines.push(
				`- **${highlight.title[locale]}** — ${highlight.description[locale]}`,
			);
		}
	}
	if (manifest.knownIssues.length > 0) {
		lines.push("", `#### ${headings.knownIssues}`, "");
		for (const issue of manifest.knownIssues) {
			lines.push(
				`- **${issue.title[locale]}** — ${issue.description[locale]}`,
			);
		}
	}
	return lines.join("\n");
}

export function renderReleaseMarkdown(
	manifest: ReleaseManifest,
	technicalAppendix = "",
): string {
	const sections = [
		renderLocaleSection(manifest, "en"),
		renderLocaleSection(manifest, "zh-Hans"),
		renderLocaleSection(manifest, "zh-Hant"),
	];
	if (technicalAppendix.trim().length > 0) {
		const technicalChanges = technicalAppendix
			.trim()
			.replace(/^## /gm, "### ");
		sections.push(
			`## Technical changes / 技术变更 / 技術變更\n\n${technicalChanges}`,
		);
	}
	return `${sections.join("\n\n---\n\n")}\n`;
}

async function loadReleaseManifests(): Promise<ReleaseManifest[]> {
	const names = (await readdir(manifestsDirectory))
		.filter((name) => name.endsWith(".yml"))
		.sort();
	const manifests = await Promise.all(
		names.map(async (name) =>
			parseReleaseManifest(
				await readFile(resolve(manifestsDirectory, name), "utf8"),
				name,
			),
		),
	);
	const versions = new Set<string>();
	for (const manifest of manifests) {
		if (versions.has(manifest.version)) {
			throw new Error(`duplicate release manifest ${manifest.version}`);
		}
		versions.add(manifest.version);
	}
	return manifests;
}

async function readJsonVersion(path: string): Promise<string> {
	const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
	const record = expectRecord(parsed, path);
	return expectString(record.version, `${path}.version`);
}

async function assertVersionFiles(version: string): Promise<void> {
	const cargo = await readFile(resolve(repositoryRoot, "Cargo.toml"), "utf8");
	const workspaceVersion = cargo.match(
		/\[workspace\.package\][\s\S]*?\nversion = "([^"]+)"/,
	)?.[1];
	if (!workspaceVersion) {
		throw new Error("Cargo.toml workspace version was not found");
	}
	const versions = new Map([
		["Cargo.toml", workspaceVersion],
		[
			"crates/desktop/package.json",
			await readJsonVersion(resolve(desktopRoot, "package.json")),
		],
		[
			"crates/desktop/src-tauri/tauri.conf.json",
			await readJsonVersion(
				resolve(desktopRoot, "src-tauri/tauri.conf.json"),
			),
		],
	]);
	for (const [path, actual] of versions) {
		if (actual !== version) {
			throw new Error(`${path} has ${actual}, expected ${version}`);
		}
	}
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

async function generateAppCatalog(manifests: ReleaseManifest[]): Promise<void> {
	await writeFile(appCatalogPath, serializeAppCatalog(manifests));
}

async function checkAppCatalog(manifests: ReleaseManifest[]): Promise<void> {
	const expected = serializeAppCatalog(manifests);
	const actual = await readFile(appCatalogPath, "utf8").catch(() => "");
	if (actual !== expected) {
		throw new Error(
			"src/generated/release-notes.json is stale; run release-notes:generate",
		);
	}
}

async function runCli(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	const manifests = await loadReleaseManifests();
	if (command === "generate") {
		await generateAppCatalog(manifests);
		return;
	}
	if (command === "check") {
		await checkAppCatalog(manifests);
		return;
	}
	if (command === "render") {
		const version = requireOption(args, "--version").replace(/^v/, "");
		const output = resolve(process.cwd(), requireOption(args, "--output"));
		const changelogPath = readOption(args, "--changelog");
		const manifest = manifests.find((entry) => entry.version === version);
		if (!manifest) {
			throw new Error(`release manifest ${version} was not found`);
		}
		await assertVersionFiles(version);
		const changelog = changelogPath
			? await readFile(resolve(process.cwd(), changelogPath), "utf8")
			: "";
		await writeFile(output, renderReleaseMarkdown(manifest, changelog));
		return;
	}
	throw new Error("expected generate, check, or render");
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
	void runCli().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

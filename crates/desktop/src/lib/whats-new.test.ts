import { describe, expect, it } from "vitest";
import {
	getWhatsNewCopy,
	pendingWhatsNew,
	resolveWhatsNewLocale,
	type WhatsNewEntry,
	WHATS_NEW_ENTRIES,
} from "./whats-new";

function release(version: string): WhatsNewEntry {
	return {
		version,
		channel: version.includes("-") ? "beta" : "stable",
		title: {
			en: `${version} title`,
			"zh-Hans": `${version} 简体标题`,
			"zh-Hant": `${version} 繁體標題`,
		},
		summary: {
			en: `${version} summary`,
			"zh-Hans": `${version} 简体摘要`,
			"zh-Hant": `${version} 繁體摘要`,
		},
		highlights: [],
		knownIssues: [],
	};
}

const releases = [
	release("1.10.0"),
	release("1.9.0"),
	release("1.8.0"),
	release("1.9.0-beta.1"),
];

describe("pendingWhatsNew", () => {
	it("excludes releases newer than the running prerelease", () => {
		expect(
			pendingWhatsNew("1.7.0", "1.9.0-beta.1", releases).map(
				(entry) => entry.version,
			),
		).toEqual(["1.8.0", "1.9.0-beta.1"]);
	});

	it("selects the newest eligible release without a watermark", () => {
		expect(
			pendingWhatsNew(null, "1.9.0-beta.1", releases).map(
				(entry) => entry.version,
			),
		).toEqual(["1.9.0-beta.1"]);
	});

	it("recovers from an invalid stored watermark", () => {
		expect(
			pendingWhatsNew("not-a-version", "1.9.0-beta.1", releases).map(
				(entry) => entry.version,
			),
		).toEqual(["1.9.0-beta.1"]);
	});

	it("does not surface beta-only notes in a stable build", () => {
		expect(
			pendingWhatsNew("1.8.0", "1.9.0", releases).map(
				(entry) => entry.version,
			),
		).toEqual(["1.9.0"]);
	});
});

describe("bundled release notes", () => {
	it("packages the current beta notes for offline display", () => {
		expect(WHATS_NEW_ENTRIES.map((entry) => entry.version)).toContain(
			"1.9.0-beta.1",
		);
	});

	it("uses the selected app language with an English fallback", () => {
		const entry = WHATS_NEW_ENTRIES.find(
			(candidate) => candidate.version === "1.9.0-beta.1",
		);
		expect(entry).toBeDefined();

		expect(resolveWhatsNewLocale("zh-Hans")).toBe("zh-Hans");
		expect(resolveWhatsNewLocale("fr")).toBe("en");
		expect(getWhatsNewCopy(entry!, "zh-Hans").title).toBe(
			"插件、隐私与桌面体验更新",
		);
	});
});

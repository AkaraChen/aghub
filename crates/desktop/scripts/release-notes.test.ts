import { describe, expect, it } from "vitest";
import {
	parseReleaseManifest,
	renderReleaseMarkdown,
	serializeAppCatalog,
} from "./release-notes";

const manifestSource = `
version: 1.9.0-beta.1
channel: beta
title:
  en: aghub 1.9 beta
  zh-Hans: aghub 1.9 测试版
  zh-Hant: aghub 1.9 測試版
summary:
  en: Preview the latest desktop changes.
  zh-Hans: 提前体验最新桌面端改动。
  zh-Hant: 提前體驗最新桌面端改動。
highlights:
  - id: offline-notes
    icon: sparkles
    title:
      en: Offline release notes
      zh-Hans: 离线版本说明
      zh-Hant: 離線版本說明
    description:
      en: Read What's New without connecting to GitHub.
      zh-Hans: 无需连接 GitHub 也能查看新功能。
      zh-Hant: 無需連線 GitHub 也能查看新功能。
knownIssues: []
`;

describe("release notes manifest", () => {
	it("keeps an optional localized announcement before the summary", () => {
		const source = `${manifestSource}\nannouncement:\n  en: The final release of aghub 1.\n  zh-Hans: 这是 aghub 1 的最后一个版本。\n  zh-Hant: 這是 aghub 1 的最後一個版本。\n`;
		const manifest = parseReleaseManifest(source, "v1.9.0-beta.1.yml");
		const markdown = renderReleaseMarkdown(manifest);
		expect(manifest.announcement?.["zh-Hans"]).toBe(
			"这是 aghub 1 的最后一个版本。",
		);
		expect(
			markdown.indexOf("The final release of aghub 1."),
		).toBeGreaterThan(0);
		expect(markdown.indexOf("The final release of aghub 1.")).toBeLessThan(
			markdown.indexOf("Preview the latest desktop changes."),
		);
		expect(markdown).toContain("這是 aghub 1 的最後一個版本。");
	});

	it("requires all translations when an announcement is present", () => {
		expect(() =>
			parseReleaseManifest(
				`${manifestSource}\nannouncement:\n  en: Final release.\n`,
				"v1.9.0-beta.1.yml",
			),
		).toThrow("announcement.zh-Hans");
	});

	it("preserves announcement line breaks in the offline catalog", () => {
		const source = `${manifestSource}\nannouncement:\n  en: |-\n    Final v1 release\n    The next version is a rewrite.\n  zh-Hans: |-\n    v1 最后一个版本\n    下一版本将重构。\n  zh-Hant: |-\n    v1 最後一個版本\n    下一版本將重構。\n`;
		const manifest = parseReleaseManifest(source, "v1.9.0-beta.1.yml");
		expect(manifest.announcement?.en).toBe(
			"Final v1 release\nThe next version is a rewrite.",
		);
		expect(serializeAppCatalog([manifest])).toContain(
			"Final v1 release\\nThe next version is a rewrite.",
		);
	});

	it("keeps the full commit and PR history in a folded release-only appendix", () => {
		const manifest = parseReleaseManifest(
			manifestSource,
			"v1.9.0-beta.1.yml",
		);
		const history =
			"## Changes\n\n- Fix windows output ([#476](https://github.com/AkaraChen/aghub/pull/476)) ([abc12345](https://github.com/AkaraChen/aghub/commit/abc12345))";
		const markdown = renderReleaseMarkdown(manifest, history);
		expect(markdown).toContain(
			"<details>\n<summary>Full changelog / 完整更新记录 / 完整更新記錄</summary>",
		);
		expect(markdown).toContain(
			history.replace("## Changes", "### Changes"),
		);
		expect(markdown).toMatch(/<\/details>\n$/);
		expect(serializeAppCatalog([manifest])).not.toContain("abc12345");
	});

	it("renders category headings without dropping highlights", () => {
		const manifest = parseReleaseManifest(
			manifestSource,
			"v1.9.0-beta.1.yml",
		);
		manifest.highlights = (["feature", "improvement", "fix"] as const).map(
			(category) => ({
				...manifest.highlights[0]!,
				id: category,
				category,
			}),
		);
		const markdown = renderReleaseMarkdown(manifest);
		expect(markdown).toContain("#### New features");
		expect(markdown).toContain("#### Improvements");
		expect(markdown).toContain("#### Fixes and maintenance");
		expect(
			markdown.match(/Read What's New without connecting to GitHub\./g),
		).toHaveLength(3);
	});

	it("parses the versioned three-locale source", () => {
		const manifest = parseReleaseManifest(
			manifestSource,
			"v1.9.0-beta.1.yml",
		);

		expect(manifest.version).toBe("1.9.0-beta.1");
		expect(manifest.channel).toBe("beta");
		expect(manifest.announcement).toBeUndefined();
		expect(manifest.highlights[0]?.title["zh-Hans"]).toBe("离线版本说明");
	});

	it("rejects a missing locale before publishing", () => {
		const missingTraditionalChinese = manifestSource.replace(
			"  zh-Hant: aghub 1.9 測試版\n",
			"",
		);

		expect(() =>
			parseReleaseManifest(
				missingTraditionalChinese,
				"v1.9.0-beta.1.yml",
			),
		).toThrow("title.zh-Hant");
	});

	it("renders product notes in all three locales", () => {
		const manifest = parseReleaseManifest(
			manifestSource,
			"v1.9.0-beta.1.yml",
		);
		const markdown = renderReleaseMarkdown(manifest);

		expect(markdown).toContain("## English");
		expect(markdown).toContain("## 简体中文");
		expect(markdown).toContain("## 繁體中文");
		expect(markdown).toContain(
			"Read What's New without connecting to GitHub.",
		);
		expect(markdown).toContain("无需连接 GitHub 也能查看新功能。");
		expect(markdown).toContain("無需連線 GitHub 也能查看新功能。");
		expect(markdown).not.toContain("Technical changes");
	});

	it("serializes a deterministic offline app catalog", () => {
		const manifest = parseReleaseManifest(
			manifestSource,
			"v1.9.0-beta.1.yml",
		);
		const catalog = JSON.parse(serializeAppCatalog([manifest])) as {
			schemaVersion: number;
			releases: Array<{ version: string }>;
		};

		expect(catalog).toEqual({
			schemaVersion: 1,
			releases: [{ ...manifest, version: "1.9.0-beta.1" }],
		});
	});
});

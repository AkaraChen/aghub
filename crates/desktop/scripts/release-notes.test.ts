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
	it("parses the versioned three-locale source", () => {
		const manifest = parseReleaseManifest(
			manifestSource,
			"v1.9.0-beta.1.yml",
		);

		expect(manifest.version).toBe("1.9.0-beta.1");
		expect(manifest.channel).toBe("beta");
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

	it("renders bilingual product notes before the technical appendix", () => {
		const manifest = parseReleaseManifest(
			manifestSource,
			"v1.9.0-beta.1.yml",
		);
		const markdown = renderReleaseMarkdown(
			manifest,
			"## Technical changes\n\n- fix: example",
		);

		expect(markdown).toContain("## English");
		expect(markdown).toContain("## 简体中文");
		expect(markdown).toContain("## 繁體中文");
		expect(markdown.indexOf("## English")).toBeLessThan(
			markdown.indexOf("## Technical changes"),
		);
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

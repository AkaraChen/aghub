import { describe, expect, it } from "vitest";
import {
	createUpdaterManifest,
	normalizeReleaseAssetName,
} from "./prepare-release-assets";

describe("release assets", () => {
	it("keeps both macOS updater archives when flattening artifacts", () => {
		expect(
			normalizeReleaseAssetName(
				"/artifacts/desktop-aarch64-apple-darwin/aghub.app.tar.gz",
				"1.9.0-beta.1",
			),
		).toBe("aghub_1.9.0-beta.1_aarch64.app.tar.gz");
		expect(
			normalizeReleaseAssetName(
				"/artifacts/desktop-x86_64-apple-darwin/aghub.app.tar.gz.sig",
				"1.9.0-beta.1",
			),
		).toBe("aghub_1.9.0-beta.1_x64.app.tar.gz.sig");
	});

	it("builds updater entries only from the staged signed artifacts", () => {
		const version = "1.9.0-beta.1";
		const signatures = new Map([
			[`aghub_${version}_aarch64.app.tar.gz.sig`, "mac-arm-signature\n"],
			[`aghub_${version}_x64.app.tar.gz.sig`, "mac-x64-signature"],
			[`aghub_${version}_amd64.AppImage.sig`, "linux-signature"],
			[`aghub_${version}_x64-setup.exe.sig`, "windows-signature"],
		]);
		const assetNames = new Set([
			...signatures.keys(),
			`aghub_${version}_aarch64.app.tar.gz`,
			`aghub_${version}_x64.app.tar.gz`,
			`aghub_${version}_amd64.AppImage`,
			`aghub_${version}_x64-setup.exe`,
		]);

		const manifest = createUpdaterManifest({
			version,
			tag: `v${version}`,
			repository: "AkaraChen/aghub",
			publishedAt: "2026-07-22T13:00:00Z",
			notes: "Beta notes",
			assetNames,
			signatures,
		});

		expect(manifest.platforms["darwin-aarch64"]).toEqual({
			signature: "mac-arm-signature",
			url: `https://github.com/AkaraChen/aghub/releases/download/v${version}/aghub_${version}_aarch64.app.tar.gz`,
		});
		expect(manifest.platforms["windows-x86_64-nsis"]).toEqual({
			signature: "windows-signature",
			url: `https://github.com/AkaraChen/aghub/releases/download/v${version}/aghub_${version}_x64-setup.exe`,
		});
		expect(Object.keys(manifest.platforms)).toHaveLength(8);
	});

	it("fails instead of publishing an incomplete updater manifest", () => {
		expect(() =>
			createUpdaterManifest({
				version: "1.9.0-beta.1",
				tag: "v1.9.0-beta.1",
				repository: "AkaraChen/aghub",
				publishedAt: "2026-07-22T13:00:00Z",
				notes: "Beta notes",
				assetNames: new Set(),
				signatures: new Map(),
			}),
		).toThrow("darwin-aarch64");
	});
});

import { describe, expect, it } from "vitest";
import { pendingWhatsNew, type WhatsNewEntry } from "./whats-new";

function release(version: string): WhatsNewEntry {
	return {
		version,
		titleKey: `${version}Title`,
		subtitleKey: `${version}Subtitle`,
		items: [],
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
});

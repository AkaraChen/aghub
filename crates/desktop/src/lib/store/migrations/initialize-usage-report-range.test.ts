import type { Store } from "@tauri-apps/plugin-store";
import { describe, expect, it } from "vitest";
import { initializeUsageReportRange } from "./initialize-usage-report-range";

function memoryStore(entries: Array<[string, unknown]> = []) {
	const values = new Map(entries);
	const store = {
		get: async <T>(key: string) => values.get(key) as T | undefined,
		set: async (key: string, value: unknown) => {
			values.set(key, value);
		},
	} satisfies Pick<Store, "get" | "set">;
	return { store, values };
}

describe("initializeUsageReportRange", () => {
	it("adds the default Usage report range to existing settings", async () => {
		const settings = { pollIntervalMs: 60_000, home: { windowDays: 30 } };
		const { store, values } = memoryStore([["usageSettings", settings]]);

		await initializeUsageReportRange(store);

		expect(values.get("usageSettings")).toEqual({
			...settings,
			reportRange: { mode: "last30", since: "", until: "" },
		});
	});

	it("preserves an existing report range", async () => {
		const settings = {
			reportRange: {
				mode: "custom",
				since: "2026-07-01",
				until: "2026-07-15",
			},
		};
		const { store, values } = memoryStore([["usageSettings", settings]]);

		await initializeUsageReportRange(store);

		expect(values.get("usageSettings")).toBe(settings);
	});

	it("does not create settings for users without Usage preferences", async () => {
		const { store, values } = memoryStore();

		await initializeUsageReportRange(store);

		expect(values.has("usageSettings")).toBe(false);
	});
});

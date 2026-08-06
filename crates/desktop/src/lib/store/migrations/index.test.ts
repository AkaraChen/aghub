import type { Store } from "@tauri-apps/plugin-store";
import { describe, expect, it } from "vitest";
import { CURRENT_VERSION } from "../types";
import { migrate } from ".";

function memoryStore(entries: Array<[string, unknown]> = []) {
	const values = new Map(entries);
	const writes: string[] = [];
	let saveCount = 0;
	const store = {
		get: async <T>(key: string) => values.get(key) as T | undefined,
		set: async (key: string, value: unknown) => {
			writes.push(key);
			values.set(key, value);
		},
		save: async () => {
			saveCount += 1;
		},
	} satisfies Pick<Store, "get" | "set" | "save">;

	return {
		store: store as Store,
		values,
		writes,
		getSaveCount: () => saveCount,
	};
}

describe("migrate", () => {
	it("runs pending migrations in schema order", async () => {
		const { store, values, writes, getSaveCount } = memoryStore();

		await migrate(store);

		expect(writes).toEqual([
			"projects",
			"disabledAgents",
			"integrationPreferences",
			"starredSkills",
			"starredMcps",
			"onboardingProgress",
			"sidebarItems",
			"autoCheckUpdates",
			"sidebarItems",
			"updateChannel",
			"acknowledgedSkillAssessments",
			"skillAuditEnabled",
			"version",
		]);
		expect(values.get("version")).toBe(CURRENT_VERSION);
		expect(getSaveCount()).toBe(1);
	});

	it("is idempotent after reaching the current version", async () => {
		const { store, writes, getSaveCount } = memoryStore();

		await migrate(store);
		const firstRunWrites = [...writes];

		await migrate(store);

		expect(writes).toEqual(firstRunWrites);
		expect(getSaveCount()).toBe(1);
	});
});

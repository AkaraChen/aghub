import type { Store } from "@tauri-apps/plugin-store";
import { describe, expect, it } from "vitest";
import { initializeSkillCopyCheck } from "./initialize-skill-copy-check";

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

describe("initializeSkillCopyCheck", () => {
	it("enables automatic copy checks by default", async () => {
		const { store, values } = memoryStore();

		await initializeSkillCopyCheck(store);

		expect(values.get("skillCopyCheck")).toEqual({
			enabled: true,
			mode: "automatic",
		});
	});

	it("preserves a valid existing preference", async () => {
		const preference = { enabled: true, mode: "manual" };
		const { store, values } = memoryStore([["skillCopyCheck", preference]]);

		await initializeSkillCopyCheck(store);

		expect(values.get("skillCopyCheck")).toBe(preference);
	});
});

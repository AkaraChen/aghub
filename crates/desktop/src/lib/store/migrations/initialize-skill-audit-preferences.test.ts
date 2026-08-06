import type { Store } from "@tauri-apps/plugin-store";
import { describe, expect, it } from "vitest";
import { initializeSkillAuditPreferences } from "./initialize-skill-audit-preferences";

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

describe("initializeSkillAuditPreferences", () => {
	it("initializes skill audit preferences", async () => {
		const { store, values } = memoryStore();

		await initializeSkillAuditPreferences(store);

		expect(values.get("acknowledgedSkillAssessments")).toEqual([]);
		expect(values.get("skillAuditEnabled")).toBe(true);
	});

	it("preserves existing acknowledgements and scan preferences", async () => {
		const assessments = [
			{ name: "reviewed", assessment_digest: "assessment" },
		];
		const { store, values } = memoryStore([
			["acknowledgedSkillAssessments", assessments],
			["skillAuditEnabled", false],
		]);

		await initializeSkillAuditPreferences(store);

		expect(values.get("acknowledgedSkillAssessments")).toBe(assessments);
		expect(values.get("skillAuditEnabled")).toBe(false);
	});
});

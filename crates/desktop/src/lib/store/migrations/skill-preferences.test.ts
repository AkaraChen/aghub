import type { Store } from "@tauri-apps/plugin-store";
import { describe, expect, it } from "vitest";
import { DEFAULT_SKILL_PREFERENCES } from "../types";
import { initializeSkillPreferences } from "./skill-preferences";

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

describe("initializeSkillPreferences", () => {
	it("adds installation, comparison, and discovery preferences", async () => {
		const { store, values } = memoryStore();

		await initializeSkillPreferences(store);

		expect(values.get("skillPreferences")).toEqual(
			DEFAULT_SKILL_PREFERENCES,
		);
	});

	it("preserves the previous copy-check state", async () => {
		const { store, values } = memoryStore([
			["skillCopyCheck", { enabled: false, mode: "manual" }],
		]);

		await initializeSkillPreferences(store);

		expect(values.get("skillPreferences")).toEqual({
			...DEFAULT_SKILL_PREFERENCES,
			enabled: false,
			mode: "manual",
		});
	});

	it("preserves a valid current preference", async () => {
		const preferences = { ...DEFAULT_SKILL_PREFERENCES };
		const { store, values } = memoryStore([
			["skillPreferences", preferences],
		]);

		await initializeSkillPreferences(store);

		expect(values.get("skillPreferences")).toBe(preferences);
	});

	it("migrates the previous comparison baseline preference", async () => {
		const { store, values } = memoryStore([
			[
				"skillPreferences",
				{
					enabled: true,
					mode: "manual",
					groupIdenticalCopies: false,
					warnOnConflicts: true,
					baselineAgent: "codex",
				},
			],
		]);

		await initializeSkillPreferences(store);

		expect(values.get("skillPreferences")).toEqual({
			...DEFAULT_SKILL_PREFERENCES,
			mode: "manual",
			groupIdenticalCopies: false,
		});
	});

	it("adds Agent-provided discovery without resetting current choices", async () => {
		const { store, values } = memoryStore([
			[
				"skillPreferences",
				{
					enabled: false,
					mode: "manual",
					groupIdenticalCopies: false,
					warnOnConflicts: false,
					defaultStorageMode: "copy",
					showDisplayNames: false,
					discovery: {
						projectSkills: false,
						embeddedSkills: true,
						dependencySkills: true,
						agentProvidedSkills: false,
					},
				},
			],
		]);

		await initializeSkillPreferences(store);

		expect(values.get("skillPreferences")).toEqual({
			enabled: false,
			mode: "manual",
			groupIdenticalCopies: false,
			warnOnConflicts: false,
			defaultStorageMode: "copy",
			showDisplayNames: false,
			discovery: {
				projectSkills: false,
				embeddedSkills: true,
				dependencySkills: true,
				agentProvidedSkills: false,
			},
		});
	});
});

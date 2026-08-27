import { describe, expect, it } from "vitest";
import type { SkillResponse } from "../generated/dto";
import {
	skillSourceTargetId,
	skillTargetIds,
	UNIVERSAL_SKILL_TARGET_ID,
} from "./skill-targets";

function skill(agent: string, paths: string[]): SkillResponse {
	return {
		name: "example",
		display_name: null,
		enabled: true,
		source_path: paths[0] ?? null,
		is_symlink: false,
		description: null,
		author: null,
		version: null,
		tools: [],
		source: "global",
		agent,
		locations: paths.map((sourcePath) => ({
			source_path: sourcePath,
			is_symlink: false,
			source: "global",
		})),
	};
}

describe("skillTargetIds", () => {
	it("identifies a universal installation", () => {
		expect(
			skillTargetIds(
				skill("codex", ["~/.agents/skills/example/SKILL.md"]),
			),
		).toEqual(new Set([UNIVERSAL_SKILL_TARGET_ID]));
	});

	it("accepts the universal target returned by the API", () => {
		expect(
			skillTargetIds(
				skill("universal", ["~/.agents/skills/example/SKILL.md"]),
			),
		).toEqual(new Set([UNIVERSAL_SKILL_TARGET_ID]));
	});

	it("keeps native and universal locations distinct", () => {
		const installed = skill("codex", [
			"~/.agents/skills/example/SKILL.md",
			"~/.codex/skills/example/SKILL.md",
		]);

		expect(skillTargetIds(installed)).toEqual(
			new Set([UNIVERSAL_SKILL_TARGET_ID, "codex"]),
		);
		expect(skillSourceTargetId(installed)).toBe("codex");
	});

	it("recognizes universal Windows locations", () => {
		const installed = skill("codex", [
			"C:\\Users\\tester\\.agents\\skills\\example\\SKILL.md",
		]);

		expect(skillTargetIds(installed)).toEqual(
			new Set([UNIVERSAL_SKILL_TARGET_ID]),
		);
	});
});

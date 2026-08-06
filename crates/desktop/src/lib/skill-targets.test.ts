import { describe, expect, it } from "vitest";
import type { SkillResponse } from "../generated/dto";
import {
	formatUniversalSkillTargetMembers,
	skillSourceTargetId,
	skillTargetIds,
	UNIVERSAL_SKILL_TARGET_ID,
} from "./skill-targets";

function skill(agent: string, paths: string[]): SkillResponse {
	return {
		name: "example",
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

describe("formatUniversalSkillTargetMembers", () => {
	it("lists only agents that read the universal directory", () => {
		const agents = [
			{
				display_name: "Codex",
				skills_paths: {
					global_read: ["~/.agents/skills"],
					project_read: [".agents/skills"],
				},
			},
			{
				display_name: "Claude",
				skills_paths: {
					global_read: ["~/.claude/skills"],
					project_read: [".claude/skills"],
				},
			},
			{
				display_name: "OpenCode",
				skills_paths: {
					global_read: ["~/.agents/skills"],
					project_read: [".agents/skills"],
				},
			},
		];

		expect(formatUniversalSkillTargetMembers(agents, "en")).toBe(
			"Codex & OpenCode",
		);
	});

	it("uses the selected scope when directory support differs", () => {
		const agents = [
			{
				display_name: "Antigravity",
				skills_paths: {
					global_read: ["~/.gemini/antigravity/skills"],
					project_read: [".agents/skills"],
				},
			},
		];

		expect(formatUniversalSkillTargetMembers(agents, "en", "global")).toBe(
			"",
		);
		expect(formatUniversalSkillTargetMembers(agents, "en", "project")).toBe(
			"Antigravity",
		);
	});
});

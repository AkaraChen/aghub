import { describe, expect, it } from "vitest";
import type { SkillResponse } from "../generated/dto";
import {
	buildLocationGroups,
	uniqueSkillLocations,
} from "./skill-detail-helpers";

function skill(agent: string, path: string, managed: boolean): SkillResponse {
	return {
		name: "agents-sdk",
		enabled: true,
		source_path: path,
		is_symlink: false,
		description: null,
		author: null,
		version: null,
		tools: [],
		source: "global",
		agent,
		locations: [
			{
				source_path: path,
				is_symlink: false,
				source: "global",
				...(managed
					? {
							provider: {
								kind: "plugin" as const,
								qualified_name: "cloudflare:agents-sdk",
								managed: true,
							},
						}
					: {}),
			},
		],
	};
}

describe("buildLocationGroups", () => {
	it("marks provider-managed paths read-only without locking mixed paths", () => {
		const managed = buildLocationGroups(
			[skill("codex", "/plugins/agents-sdk/SKILL.md", true)],
			[],
		);
		const mixed = buildLocationGroups(
			[
				skill("codex", "/shared/agents-sdk/SKILL.md", true),
				skill("claude", "/shared/agents-sdk/SKILL.md", false),
			],
			[],
		);

		expect(managed[0]?.managed).toBe(true);
		expect(mixed[0]?.managed).toBe(false);
	});

	it("excludes Agent-managed paths from writable sync targets", () => {
		expect(
			uniqueSkillLocations([
				skill("codex", "/plugins/agents-sdk/SKILL.md", true),
				skill("claude", "/home/skills/agents-sdk/SKILL.md", false),
			]),
		).toEqual([
			{
				sourcePath: "/home/skills/agents-sdk/SKILL.md",
				isSymlink: false,
				agents: ["claude"],
			},
		]);
	});
});

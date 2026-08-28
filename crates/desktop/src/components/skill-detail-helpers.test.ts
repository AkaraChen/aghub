import { describe, expect, it } from "vitest";
import type { SkillResponse, SkillTreeNodeResponse } from "../generated/dto";
import {
	buildLocationGroups,
	findContainedSkills,
	uniqueSkillLocations,
} from "./skill-detail-helpers";

function skill(agent: string, path: string, managed: boolean): SkillResponse {
	return {
		name: "agents-sdk",
		display_name: null,
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

describe("findContainedSkills", () => {
	it("returns every nested Skill without treating the root as its own child", () => {
		const tree: SkillTreeNodeResponse = {
			name: "repository",
			path: "/skills/repository",
			kind: "directory",
			skill: {
				name: "repository",
				display_name: "Repository",
			},
			children: [
				{
					name: "SKILL.md",
					path: "/skills/repository/SKILL.md",
					kind: "file",
					children: [],
				},
				{
					name: "direct-child",
					path: "/skills/repository/direct-child",
					kind: "directory",
					skill: {
						name: "direct-command",
						display_name: "Direct Child",
					},
					children: [
						{
							name: "SKILL.md",
							path: "/skills/repository/direct-child/SKILL.md",
							kind: "file",
							children: [],
						},
					],
				},
				{
					name: "vendor",
					path: "/skills/repository/vendor",
					kind: "directory",
					children: [
						{
							name: "tooling",
							path: "/skills/repository/vendor/tooling",
							kind: "directory",
							skill: {
								name: "tooling-command",
								display_name: null,
							},
							children: [
								{
									name: "SKILL.md",
									path: "/skills/repository/vendor/tooling/SKILL.md",
									kind: "file",
									children: [],
								},
								{
									name: "skills",
									path: "/skills/repository/vendor/tooling/skills",
									kind: "directory",
									children: [
										{
											name: "review",
											path: "/skills/repository/vendor/tooling/skills/review",
											kind: "directory",
											skill: {
												name: "review-command",
												display_name: "Review",
											},
											children: [
												{
													name: "SKILL.md",
													path: "/skills/repository/vendor/tooling/skills/review/SKILL.md",
													kind: "file",
													children: [],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		};

		expect(findContainedSkills(tree)).toEqual([
			{
				name: "direct-command",
				displayName: "Direct Child",
				relativePath: "direct-child",
			},
			{
				name: "tooling-command",
				displayName: null,
				relativePath: "vendor/tooling",
			},
			{
				name: "review-command",
				displayName: "Review",
				relativePath: "vendor/tooling/skills/review",
			},
		]);
	});
});

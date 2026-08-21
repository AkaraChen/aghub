import { describe, expect, it } from "vitest";
import type { AgentInfo } from "../generated/dto";
import { supportsIndividualSkillTarget } from "./agent-capabilities";

function agentWithWritePaths(
	globalWrite: string | null,
	projectWrite: string | null,
	universal = true,
): AgentInfo {
	return {
		id: "test",
		display_name: "Test",
		capabilities: {
			skills: {
				scopes: { global: true, project: true },
				universal,
				mutable_global: Boolean(globalWrite),
				mutable_project: Boolean(projectWrite),
			},
			mcp: {
				scopes: { global: false, project: false },
				stdio: false,
				remote: false,
				enable_disable: false,
			},
			sub_agents: { scopes: { global: false, project: false } },
		},
		skills_paths: {
			global_read: [],
			global_write: globalWrite,
			project_read: [],
			project_write: projectWrite,
		},
	};
}

describe("supportsIndividualSkillTarget", () => {
	it("keeps a distinct native directory available", () => {
		const agent = agentWithWritePaths(
			"~/.claude/skills",
			".claude/skills",
			false,
		);

		expect(supportsIndividualSkillTarget(agent, "global")).toBe(true);
		expect(supportsIndividualSkillTarget(agent, "project")).toBe(true);
	});

	it("keeps a distinct native directory for universal readers", () => {
		const agent = agentWithWritePaths("~/.codex/skills", ".codex/skills");

		expect(supportsIndividualSkillTarget(agent, "global")).toBe(true);
		expect(supportsIndividualSkillTarget(agent, "project")).toBe(true);
	});

	it("does not duplicate the universal directory", () => {
		const agent = agentWithWritePaths("~/.agents/skills", ".agents/skills");

		expect(supportsIndividualSkillTarget(agent, "global")).toBe(false);
		expect(supportsIndividualSkillTarget(agent, "project")).toBe(false);
	});

	it("recognizes the universal directory on Windows", () => {
		const agent = agentWithWritePaths(
			"C:\\Users\\tester\\.agents\\skills",
			null,
		);

		expect(supportsIndividualSkillTarget(agent, "global")).toBe(false);
		expect(supportsIndividualSkillTarget(agent, "project")).toBe(false);
	});
});

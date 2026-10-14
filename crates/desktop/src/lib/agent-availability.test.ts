import { describe, expect, it } from "vitest";
import type { AgentAvailabilityDto, AgentInfo } from "../generated/dto";
import {
	canPrepareAgentConfiguration,
	isAgentDetected,
} from "./agent-availability";

const supportedAgent = {
	id: "cursor",
	display_name: "Cursor",
	surfaces: [],
	capabilities: {
		skills: {
			scopes: { global: true, project: true },
			universal: true,
			mutable_global: true,
			mutable_project: true,
		},
		mcp: {
			scopes: { global: true, project: true },
			stdio: true,
			remote: true,
			sse: true,
			streamable_http: true,
			enable_disable: false,
		},
		sub_agents: { scopes: { global: false, project: true } },
	},
	skills_paths: {
		global_read: [],
		global_write: "~/.cursor/skills",
		project_read: [],
		project_write: ".cursor/skills",
	},
} satisfies AgentInfo;

function availability(
	state: AgentAvailabilityDto["state"],
): AgentAvailabilityDto {
	return {
		id: "cursor",
		state,
		configured: false,
		surfaces: [],
	};
}

describe("agent availability", () => {
	it("only treats detected runtime evidence as detected", () => {
		expect(isAgentDetected(availability("detected"))).toBe(true);
		expect(isAgentDetected(availability("not_detected"))).toBe(false);
		expect(isAgentDetected(availability("unknown"))).toBe(false);
		expect(isAgentDetected(availability("error"))).toBe(false);
	});

	it("allows an explicit configuration target without detection", () => {
		expect(canPrepareAgentConfiguration(supportedAgent, false)).toBe(true);
		expect(canPrepareAgentConfiguration(supportedAgent, true)).toBe(false);
	});
});

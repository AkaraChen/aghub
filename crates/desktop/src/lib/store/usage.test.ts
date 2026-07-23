import { describe, expect, it } from "vitest";
import {
	agentSettings,
	createDefaultUsageSettings,
	trackedUsageAgents,
} from "./usage";

describe("usage tracking settings", () => {
	it("tracks agents by default for existing stores", () => {
		const settings = createDefaultUsageSettings();

		expect(agentSettings(settings, "kilocode").tracked).toBe(true);
	});

	it("filters probes using the persisted per-agent choice", () => {
		const settings = createDefaultUsageSettings();
		settings.agents.kilocode = {
			alertThresholdPct: null,
			tracked: false,
		};

		expect(
			trackedUsageAgents(settings, ["claude", "kilocode", "opencode"]),
		).toEqual(["claude", "opencode"]);
	});
});

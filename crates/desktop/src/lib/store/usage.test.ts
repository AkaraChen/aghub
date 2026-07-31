import { describe, expect, it } from "vitest";
import { agentSettings, createDefaultUsageSettings } from "./usage";

describe("usage agent settings", () => {
	it("uses the global alert threshold by default", () => {
		const settings = createDefaultUsageSettings();

		expect(
			agentSettings(settings, "kilocode").alertThresholdPct,
		).toBeNull();
	});
});

import { describe, expect, it } from "vitest";
import { agentSettings, createDefaultUsageSettings } from "./usage";

describe("usage agent settings", () => {
	it("hides usage on home cards by default", () => {
		const settings = createDefaultUsageSettings();

		expect(settings.home.showUsageOnHome).toBe(false);
	});

	it("uses the global warning level by default", () => {
		const settings = createDefaultUsageSettings();

		expect(
			agentSettings(settings, "kilocode").alertThresholdPct,
		).toBeNull();
	});
});

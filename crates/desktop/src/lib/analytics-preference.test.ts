import { beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
	acknowledge: vi.fn<(value: "granted" | "denied") => Promise<void>>(),
	apply: vi.fn<(enabled: boolean) => Promise<void>>(),
}));

vi.mock("./analytics", () => ({
	applyAnalyticsConsent: analyticsMocks.apply,
}));

vi.mock("./store", () => ({
	acknowledgeAnalyticsConsent: analyticsMocks.acknowledge,
}));

import { saveAnalyticsPreference } from "./analytics-preference";

describe("saveAnalyticsPreference", () => {
	beforeEach(() => {
		analyticsMocks.acknowledge.mockReset();
		analyticsMocks.acknowledge.mockResolvedValue();
		analyticsMocks.apply.mockReset();
		analyticsMocks.apply.mockResolvedValue();
	});

	it("persists and applies an acknowledged preference", async () => {
		const saved = await saveAnalyticsPreference(false);

		expect(saved).toBe(false);
		expect(analyticsMocks.acknowledge).toHaveBeenCalledWith("denied");
		expect(analyticsMocks.apply).toHaveBeenCalledWith(false);
	});

	it("does not change runtime state when persistence fails", async () => {
		analyticsMocks.acknowledge.mockRejectedValueOnce(
			new Error("store failed"),
		);

		await expect(saveAnalyticsPreference(false)).rejects.toThrow(
			"store failed",
		);
		expect(analyticsMocks.apply).not.toHaveBeenCalled();
	});

	it("keeps the saved preference when runtime application fails", async () => {
		const error = new Error("runtime failed");
		analyticsMocks.apply.mockRejectedValueOnce(error);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(saveAnalyticsPreference(true)).resolves.toBe(true);
		expect(analyticsMocks.acknowledge).toHaveBeenCalledWith("granted");
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to apply analytics preference:",
			error,
		);
		consoleError.mockRestore();
	});
});

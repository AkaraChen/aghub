import { beforeEach, describe, expect, it, vi } from "vitest";

const storeState = vi.hoisted(() => ({
	values: new Map<string, unknown>(),
	set: vi.fn<(key: string, value: unknown) => Promise<void>>(),
	save: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
	Store: {
		load: vi.fn(async () => ({
			get: async (key: string) => storeState.values.get(key),
			set: storeState.set,
			save: storeState.save,
		})),
	},
}));

vi.mock("./migrations", () => ({ migrate: vi.fn() }));

import { acknowledgeAnalyticsConsent } from "./index";

describe("acknowledgeAnalyticsConsent", () => {
	beforeEach(() => {
		storeState.values.clear();
		storeState.set.mockReset();
		storeState.set.mockImplementation(async (key, value) => {
			storeState.values.set(key, value);
		});
		storeState.save.mockReset();
		storeState.save.mockResolvedValue();
	});

	it("persists the consent value and acknowledgement together", async () => {
		await acknowledgeAnalyticsConsent("denied");

		expect(storeState.values.get("analyticsConsent")).toBe("denied");
		expect(storeState.values.get("analyticsConsentAcked")).toBe(true);
		expect(storeState.save).toHaveBeenCalledTimes(1);
	});

	it("restores in-memory values when saving fails", async () => {
		storeState.values.set("analyticsConsent", "granted");
		storeState.values.set("analyticsConsentAcked", false);
		storeState.save.mockRejectedValueOnce(new Error("write failed"));

		await expect(acknowledgeAnalyticsConsent("denied")).rejects.toThrow(
			"write failed",
		);
		expect(storeState.values.get("analyticsConsent")).toBe("granted");
		expect(storeState.values.get("analyticsConsentAcked")).toBe(false);
	});

	it("restores the consent value when acknowledgement writing fails", async () => {
		storeState.values.set("analyticsConsent", "granted");
		storeState.values.set("analyticsConsentAcked", false);
		storeState.set
			.mockImplementationOnce(async (key, value) => {
				storeState.values.set(key, value);
			})
			.mockRejectedValueOnce(new Error("set failed"));

		await expect(acknowledgeAnalyticsConsent("denied")).rejects.toThrow(
			"set failed",
		);
		expect(storeState.values.get("analyticsConsent")).toBe("granted");
		expect(storeState.values.get("analyticsConsentAcked")).toBe(false);
	});
});

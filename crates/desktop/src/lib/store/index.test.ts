import { beforeEach, describe, expect, it, vi } from "vitest";

const storeState = vi.hoisted(() => ({
	values: new Map<string, unknown>(),
	delete: vi.fn<(key: string) => Promise<boolean>>(),
	set: vi.fn<(key: string, value: unknown) => Promise<void>>(),
	save: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
	Store: {
		load: vi.fn(async () => ({
			get: async (key: string) => storeState.values.get(key),
			delete: storeState.delete,
			set: storeState.set,
			save: storeState.save,
		})),
	},
}));

vi.mock("./migrations", () => ({ migrate: vi.fn() }));

import { acknowledgeAnalyticsConsent } from "./index";
import { saveOnboardingCompletion } from "./onboarding";

describe("acknowledgeAnalyticsConsent", () => {
	beforeEach(() => {
		storeState.values.clear();
		storeState.delete.mockReset();
		storeState.delete.mockImplementation(async (key) =>
			storeState.values.delete(key),
		);
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

describe("saveOnboardingCompletion", () => {
	beforeEach(() => {
		storeState.values.clear();
		storeState.delete.mockReset();
		storeState.delete.mockImplementation(async (key) =>
			storeState.values.delete(key),
		);
		storeState.set.mockReset();
		storeState.set.mockImplementation(async (key, value) => {
			storeState.values.set(key, value);
		});
		storeState.save.mockReset();
		storeState.save.mockResolvedValue();
	});

	it("commits consent, release notes, and welcome progress with one save", async () => {
		await saveOnboardingCompletion({
			analyticsConsent: "granted",
			lastSeenWhatsNewVersion: "1.9.0-beta.1",
		});

		expect(storeState.values.get("analyticsConsent")).toBe("granted");
		expect(storeState.values.get("analyticsConsentAcked")).toBe(true);
		expect(storeState.values.get("lastSeenWhatsNewVersion")).toBe(
			"1.9.0-beta.1",
		);
		expect(storeState.values.get("onboardingProgress")).toMatchObject({
			hasSeenWelcome: true,
		});
		expect(storeState.save).toHaveBeenCalledTimes(1);
	});

	it("restores every staged value when the save fails", async () => {
		const previousProgress = {
			hasSeenWelcome: false,
			completedTours: { productMap: true, projectWorkflow: false },
		};
		storeState.values.set("onboardingProgress", previousProgress);
		storeState.values.set("analyticsConsent", "denied");
		storeState.values.set("analyticsConsentAcked", false);
		storeState.save.mockRejectedValueOnce(new Error("write failed"));

		await expect(
			saveOnboardingCompletion({
				analyticsConsent: "granted",
				lastSeenWhatsNewVersion: "1.9.0-beta.1",
			}),
		).rejects.toThrow("write failed");

		expect(storeState.values.get("onboardingProgress")).toEqual(
			previousProgress,
		);
		expect(storeState.values.get("analyticsConsent")).toBe("denied");
		expect(storeState.values.get("analyticsConsentAcked")).toBe(false);
		expect(storeState.values.has("lastSeenWhatsNewVersion")).toBe(false);
	});
});

import { applyAnalyticsConsent } from "./analytics";
import { acknowledgeAnalyticsConsent } from "./store";

export async function saveAnalyticsPreference(enabled: boolean) {
	await acknowledgeAnalyticsConsent(enabled ? "granted" : "denied");
	try {
		await applyAnalyticsConsent(enabled);
	} catch (error) {
		console.error("Failed to apply analytics preference:", error);
	}
	return enabled;
}

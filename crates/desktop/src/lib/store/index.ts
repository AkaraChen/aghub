import { Store } from "@tauri-apps/plugin-store";
import { migrate } from "./migrations";

let store: Store | null = null;

export async function getStore(): Promise<Store> {
	if (!store) {
		store = await Store.load("store.json");
	}
	return store;
}

export async function initStore(): Promise<void> {
	const store = await getStore();
	await migrate(store);
}

export type AnalyticsConsent = "granted" | "denied";

const ANALYTICS_CONSENT_KEY = "analyticsConsent";
const ANALYTICS_CONSENT_ACK_KEY = "analyticsConsentAcked";

/**
 * Default for users who have not made an analytics choice yet: denied.
 * Analytics starts only after the user grants consent in the welcome
 * dialog or Settings.
 */
const DEFAULT_CONSENT: AnalyticsConsent = "denied";

export async function getAnalyticsConsent(): Promise<AnalyticsConsent> {
	const s = await getStore();
	const value = await s.get<AnalyticsConsent>(ANALYTICS_CONSENT_KEY);
	if (value === "granted" || value === "denied") return value;
	return DEFAULT_CONSENT;
}

export async function acknowledgeAnalyticsConsent(
	value: AnalyticsConsent,
): Promise<void> {
	const s = await getStore();
	const previousConsent = await getAnalyticsConsent();
	const previousAcked = await getConsentAcked();

	try {
		await s.set(ANALYTICS_CONSENT_KEY, value);
		await s.set(ANALYTICS_CONSENT_ACK_KEY, true);
		await s.save();
	} catch (error) {
		try {
			await s.set(ANALYTICS_CONSENT_KEY, previousConsent);
			await s.set(ANALYTICS_CONSENT_ACK_KEY, previousAcked);
		} catch (rollbackError) {
			throw new AggregateError(
				[error, rollbackError],
				"Failed to save or restore analytics consent",
			);
		}
		throw error;
	}
}

/**
 * Whether the user has explicitly acknowledged the consent prompt.
 * Distinct from `analyticsConsent` itself so users upgrading from a
 * pre-consent build see the one-time consent step even when a prior
 * release already stored an analytics preference.
 */
export async function getConsentAcked(): Promise<boolean> {
	const s = await getStore();
	const value = await s.get<boolean>(ANALYTICS_CONSENT_ACK_KEY);
	return value === true;
}

const AUTO_CHECK_UPDATES_KEY = "autoCheckUpdates";

/**
 * Default: enabled. The app will check for updates on startup unless
 * the user has explicitly opted out via Settings → Application.
 */
const DEFAULT_AUTO_CHECK_UPDATES = true;

export async function getAutoCheckUpdates(): Promise<boolean> {
	const s = await getStore();
	const value = await s.get<boolean>(AUTO_CHECK_UPDATES_KEY);
	if (typeof value === "boolean") return value;
	return DEFAULT_AUTO_CHECK_UPDATES;
}

export async function setAutoCheckUpdates(value: boolean): Promise<boolean> {
	const s = await getStore();
	await s.set(AUTO_CHECK_UPDATES_KEY, value);
	await s.save();
	return value;
}

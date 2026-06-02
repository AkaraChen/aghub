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

export async function setAnalyticsConsent(
	value: AnalyticsConsent,
): Promise<AnalyticsConsent> {
	const s = await getStore();
	await s.set(ANALYTICS_CONSENT_KEY, value);
	await s.save();
	return value;
}

/**
 * Whether the user has explicitly acknowledged the consent prompt.
 * Distinct from `analyticsConsent` itself: a user upgrading from a
 * pre-consent build implicitly has `analyticsConsent === "granted"`
 * but `consentAcked === false`, which is what triggers the
 * one-time consent step in the welcome/upgrade wizard.
 */
export async function getConsentAcked(): Promise<boolean> {
	const s = await getStore();
	const value = await s.get<boolean>(ANALYTICS_CONSENT_ACK_KEY);
	return value === true;
}

export async function setConsentAcked(value: boolean): Promise<void> {
	const s = await getStore();
	await s.set(ANALYTICS_CONSENT_ACK_KEY, value);
	await s.save();
}

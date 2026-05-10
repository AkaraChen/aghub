import { getStore } from ".";

export type AnalyticsConsent = "granted" | "denied";

const STORE_KEY = "analyticsConsent";
const ACK_KEY = "analyticsConsentAcked";

/**
 * Default for users who never saw the welcome dialog (or upgraded
 * from a pre-consent build): granted. Aligns with desktop-tool
 * convention — users actively opt out via the welcome dialog or
 * Settings → Application rather than being asked on every launch.
 */
const DEFAULT_CONSENT: AnalyticsConsent = "granted";

export async function getAnalyticsConsent(): Promise<AnalyticsConsent> {
	const store = await getStore();
	const value = await store.get<AnalyticsConsent>(STORE_KEY);
	if (value === "granted" || value === "denied") return value;
	return DEFAULT_CONSENT;
}

export async function setAnalyticsConsent(
	value: AnalyticsConsent,
): Promise<AnalyticsConsent> {
	const store = await getStore();
	await store.set(STORE_KEY, value);
	await store.save();
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
	const store = await getStore();
	const value = await store.get<boolean>(ACK_KEY);
	return value === true;
}

export async function setConsentAcked(value: boolean): Promise<void> {
	const store = await getStore();
	await store.set(ACK_KEY, value);
	await store.save();
}

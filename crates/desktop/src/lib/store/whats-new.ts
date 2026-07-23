import { getStore } from ".";

const STORE_KEY = "lastSeenWhatsNewVersion";

/**
 * The highest app version for which the user has acknowledged the
 * What's New step in the upgrade wizard. We only show entries
 * strictly newer than this. `null` means the user has never
 * acknowledged any version (a brand-new install or pre-feature
 * upgrade).
 */
export async function getLastSeenWhatsNewVersion(): Promise<string | null> {
	const store = await getStore();
	const value = await store.get<string>(STORE_KEY);
	return typeof value === "string" && value.length > 0 ? value : null;
}

export async function setLastSeenWhatsNewVersion(
	version: string,
): Promise<void> {
	const store = await getStore();
	await store.set(STORE_KEY, version);
	await store.save();
}

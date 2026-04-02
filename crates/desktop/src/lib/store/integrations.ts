import { getStore } from ".";
import type { IntegrationPreferences } from "./types";

export async function getIntegrationPreferences(): Promise<IntegrationPreferences> {
	const store = await getStore();
	return (
		(await store.get<IntegrationPreferences>("integrationPreferences")) ??
		{}
	);
}

export async function saveIntegrationPreferences(
	preferences: IntegrationPreferences,
): Promise<void> {
	const store = await getStore();
	await store.set("integrationPreferences", preferences);
	await store.save();
}

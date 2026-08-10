import type { Store } from "@tauri-apps/plugin-store";

export async function initializeIntegrationPreferences(
	store: Store,
): Promise<void> {
	await store.set("integrationPreferences", {});
}

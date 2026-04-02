import type { Store } from "@tauri-apps/plugin-store";

export async function migrateV2ToV3(store: Store): Promise<void> {
	await store.set("integrationPreferences", {});
}

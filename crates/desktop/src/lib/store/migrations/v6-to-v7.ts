import type { Store } from "@tauri-apps/plugin-store";

export async function migrateV6ToV7(store: Store): Promise<void> {
	await store.set("autoCheckUpdates", true);
}

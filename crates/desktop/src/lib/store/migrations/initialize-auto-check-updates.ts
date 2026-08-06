import type { Store } from "@tauri-apps/plugin-store";

export async function initializeAutoCheckUpdates(store: Store): Promise<void> {
	await store.set("autoCheckUpdates", true);
}

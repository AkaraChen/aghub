import type { Store } from "@tauri-apps/plugin-store";

export async function migrateV0ToV1(store: Store): Promise<void> {
	await store.set("projects", []);
}

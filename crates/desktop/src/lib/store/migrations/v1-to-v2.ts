import type { Store } from "@tauri-apps/plugin-store";

export async function migrateV1ToV2(store: Store): Promise<void> {
	await store.set("disabledAgents", []);
}

import type { Store } from "@tauri-apps/plugin-store";

export async function migrateV3ToV4(store: Store): Promise<void> {
	await store.set("starredSkills", []);
	await store.set("starredMcps", []);
}

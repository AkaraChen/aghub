import type { Store } from "@tauri-apps/plugin-store";

export async function initializeStarredResources(store: Store): Promise<void> {
	await store.set("starredSkills", []);
	await store.set("starredMcps", []);
}

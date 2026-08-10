import type { Store } from "@tauri-apps/plugin-store";

export async function initializeProjects(store: Store): Promise<void> {
	await store.set("projects", []);
}

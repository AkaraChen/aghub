import type { Store } from "@tauri-apps/plugin-store";

export async function initializeDisabledAgents(store: Store): Promise<void> {
	await store.set("disabledAgents", []);
}

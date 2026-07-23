import type { Store } from "@tauri-apps/plugin-store";

export async function migrateV8ToV9(store: Store): Promise<void> {
	const channel = await store.get<string>("updateChannel");
	if (channel !== "stable" && channel !== "beta") {
		await store.set("updateChannel", "stable");
	}
}

import type { Store } from "@tauri-apps/plugin-store";

export async function normalizeUpdateChannel(store: Store): Promise<void> {
	const channel = await store.get<string>("updateChannel");
	if (channel !== "stable" && channel !== "beta") {
		await store.set("updateChannel", "stable");
	}
}

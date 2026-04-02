import { Store } from "@tauri-apps/plugin-store";
import { migrate } from "./migrations";

let store: Store | null = null;

export async function getStore(): Promise<Store> {
	if (!store) {
		store = await Store.load("store.json");
	}
	return store;
}

export async function initStore(): Promise<void> {
	const store = await getStore();
	await migrate(store);
}

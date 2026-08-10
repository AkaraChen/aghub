import type { Store } from "@tauri-apps/plugin-store";
import { DEFAULT_SIDEBAR_ITEMS } from "../types";

export async function resetSidebarItems(store: Store): Promise<void> {
	await store.set("sidebarItems", DEFAULT_SIDEBAR_ITEMS);
}

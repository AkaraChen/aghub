import type { Store } from "@tauri-apps/plugin-store";

const GROUP_KEYS = [
	["skillGroups", []],
	["skillGroupAssignments", {}],
	["mcpGroups", []],
	["mcpGroupAssignments", {}],
] as const;

export async function migrateV8ToV9(store: Store): Promise<void> {
	// Groups are user-created data: after a downgrade/upgrade cycle the
	// version is clamped back below 9 while the keys still hold data, so
	// only initialize keys that are absent instead of overwriting them.
	for (const [key, initial] of GROUP_KEYS) {
		if ((await store.get(key)) == null) {
			await store.set(key, initial);
		}
	}
}

import type { Store } from "@tauri-apps/plugin-store";

export async function migrateV9ToV10(store: Store): Promise<void> {
	const trustedSkills = await store.get<unknown>("trustedSkills");
	if (!Array.isArray(trustedSkills)) {
		await store.set("trustedSkills", []);
	}

	const skillAuditEnabled = await store.get<unknown>("skillAuditEnabled");
	if (typeof skillAuditEnabled !== "boolean") {
		await store.set("skillAuditEnabled", true);
	}
}

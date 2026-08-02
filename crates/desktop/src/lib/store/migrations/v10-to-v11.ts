import type { Store } from "@tauri-apps/plugin-store";
import {
	DEFAULT_SKILL_COPY_CHECK,
	type SkillCopyCheckPreference,
} from "../types";

type MigrationStore = Pick<Store, "get" | "set">;

function isSkillCopyCheckPreference(
	value: unknown,
): value is SkillCopyCheckPreference {
	if (!value || typeof value !== "object") return false;
	const preference = value as Partial<SkillCopyCheckPreference>;
	return (
		typeof preference.enabled === "boolean" &&
		(preference.mode === "automatic" || preference.mode === "manual")
	);
}

export async function migrateV10ToV11(store: MigrationStore): Promise<void> {
	const preference = await store.get<unknown>("skillCopyCheck");
	if (!isSkillCopyCheckPreference(preference)) {
		await store.set("skillCopyCheck", DEFAULT_SKILL_COPY_CHECK);
	}
}

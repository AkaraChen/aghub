import type { Store } from "@tauri-apps/plugin-store";
import {
	DEFAULT_SKILL_PREFERENCES,
	isSkillPreferences,
	type SkillCopyCheckMode,
} from "../types";

type MigrationStore = Pick<Store, "get" | "set">;

interface LegacySkillCopyCheck {
	enabled: boolean;
	mode: SkillCopyCheckMode;
}

interface PreviousSkillPreferences extends LegacySkillCopyCheck {
	groupIdenticalCopies?: boolean;
	warnOnConflicts?: boolean;
}

function isLegacySkillCopyCheck(value: unknown): value is LegacySkillCopyCheck {
	if (!value || typeof value !== "object") return false;
	const preference = value as Partial<LegacySkillCopyCheck>;
	return (
		typeof preference.enabled === "boolean" &&
		(preference.mode === "automatic" || preference.mode === "manual")
	);
}

export async function initializeSkillPreferences(
	store: MigrationStore,
): Promise<void> {
	const current = await store.get<unknown>("skillPreferences");
	if (isSkillPreferences(current)) return;

	const legacy = await store.get<unknown>("skillCopyCheck");
	const previous = isLegacySkillCopyCheck(current)
		? (current as PreviousSkillPreferences)
		: undefined;
	const copyCheck =
		previous ?? (isLegacySkillCopyCheck(legacy) ? legacy : undefined);
	await store.set("skillPreferences", {
		...DEFAULT_SKILL_PREFERENCES,
		...(copyCheck
			? { enabled: copyCheck.enabled, mode: copyCheck.mode }
			: {}),
		...(typeof previous?.groupIdenticalCopies === "boolean"
			? { groupIdenticalCopies: previous.groupIdenticalCopies }
			: {}),
		...(typeof previous?.warnOnConflicts === "boolean"
			? { warnOnConflicts: previous.warnOnConflicts }
			: {}),
	});
}

import { getStore } from ".";
import {
	DEFAULT_SKILL_COPY_CHECK,
	type SkillCopyCheckPreference,
} from "./types";

const SKILL_COPY_CHECK_KEY = "skillCopyCheck";

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

export async function getSkillCopyCheckPreference(): Promise<SkillCopyCheckPreference> {
	const store = await getStore();
	const value = await store.get<unknown>(SKILL_COPY_CHECK_KEY);
	return isSkillCopyCheckPreference(value) ? value : DEFAULT_SKILL_COPY_CHECK;
}

export async function setSkillCopyCheckPreference(
	preference: SkillCopyCheckPreference,
): Promise<SkillCopyCheckPreference> {
	const store = await getStore();
	await store.set(SKILL_COPY_CHECK_KEY, preference);
	await store.save();
	return preference;
}

import { getStore } from ".";
import {
	DEFAULT_SKILL_PREFERENCES,
	isSkillPreferences,
	type SkillPreferences,
} from "./types";

const SKILL_PREFERENCES_KEY = "skillPreferences";

export async function getSkillPreferences(): Promise<SkillPreferences> {
	const store = await getStore();
	const value = await store.get<unknown>(SKILL_PREFERENCES_KEY);
	return isSkillPreferences(value) ? value : DEFAULT_SKILL_PREFERENCES;
}

export async function setSkillPreferences(
	preferences: SkillPreferences,
): Promise<SkillPreferences> {
	const store = await getStore();
	await store.set(SKILL_PREFERENCES_KEY, preferences);
	await store.save();
	return preferences;
}

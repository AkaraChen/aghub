import { useQuery } from "@tanstack/react-query";
import { DEFAULT_SKILL_PREFERENCES } from "../lib/store";
import { skillPreferencesQueryOptions } from "../requests/preferences";

export function useSkillPreferences() {
	const query = useQuery(skillPreferencesQueryOptions());

	return {
		skillPreferences: query.data ?? DEFAULT_SKILL_PREFERENCES,
		skillPreferencesReady: query.isSuccess,
	};
}

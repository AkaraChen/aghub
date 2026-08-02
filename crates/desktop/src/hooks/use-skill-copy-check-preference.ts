import { useQuery } from "@tanstack/react-query";
import { DEFAULT_SKILL_COPY_CHECK } from "../lib/store";
import { skillCopyCheckPreferenceQueryOptions } from "../requests/preferences";

export function useSkillCopyCheckPreference() {
	const query = useQuery(skillCopyCheckPreferenceQueryOptions());

	return {
		skillCopyCheckPreference: query.data ?? DEFAULT_SKILL_COPY_CHECK,
		skillCopyCheckReady: query.isSuccess,
	};
}

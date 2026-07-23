import { useQuery } from "@tanstack/react-query";
import { skillAuditPreferenceQueryOptions } from "../requests/preferences";

export function useSkillAuditPreference() {
	const query = useQuery(skillAuditPreferenceQueryOptions());

	return {
		skillAuditEnabled: query.data === true,
		skillAuditReady: query.isSuccess,
	};
}

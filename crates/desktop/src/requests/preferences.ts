import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { getSkillAuditEnabled, setSkillAuditEnabled } from "../lib/store";
import { queryKeys } from "./keys";

export function skillAuditPreferenceQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.preferences.skillAudit(),
		queryFn: getSkillAuditEnabled,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function setSkillAuditPreferenceMutationOptions(
	queryClient: QueryClient,
	onSuccess?: (enabled: boolean) => void | Promise<void>,
) {
	return mutationOptions({
		mutationFn: setSkillAuditEnabled,
		onSuccess: async (enabled) => {
			queryClient.setQueryData(
				queryKeys.preferences.skillAudit(),
				enabled,
			);
			if (!enabled) {
				await queryClient.cancelQueries({
					queryKey: queryKeys.skills.audits(),
				});
				queryClient.removeQueries({
					queryKey: queryKeys.skills.audits(),
				});
			}
			await onSuccess?.(enabled);
		},
	});
}

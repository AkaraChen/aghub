import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import {
	getSkillAuditEnabled,
	getSkillCopyCheckPreference,
	setSkillAuditEnabled,
	setSkillCopyCheckPreference,
	type SkillCopyCheckPreference,
} from "../lib/store";
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

export function skillCopyCheckPreferenceQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.preferences.skillCopyCheck(),
		queryFn: getSkillCopyCheckPreference,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function setSkillCopyCheckPreferenceMutationOptions(
	queryClient: QueryClient,
	onSuccess?: (preference: SkillCopyCheckPreference) => void | Promise<void>,
) {
	return mutationOptions({
		mutationFn: setSkillCopyCheckPreference,
		onSuccess: async (preference) => {
			queryClient.setQueryData(
				queryKeys.preferences.skillCopyCheck(),
				preference,
			);
			if (!preference.enabled || preference.mode === "manual") {
				await Promise.all([
					queryClient.cancelQueries({
						queryKey: queryKeys.skills.diffs(),
					}),
					queryClient.cancelQueries({
						queryKey: queryKeys.skills.copyStatuses(),
					}),
				]);
				queryClient.removeQueries({
					queryKey: queryKeys.skills.diffs(),
				});
				queryClient.removeQueries({
					queryKey: queryKeys.skills.copyStatuses(),
				});
			}
			await onSuccess?.(preference);
		},
	});
}

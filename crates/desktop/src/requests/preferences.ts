import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import {
	getSkillAuditEnabled,
	getSkillPreferences,
	setSkillAuditEnabled,
	setSkillPreferences,
	type SkillPreferences,
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

export function skillPreferencesQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.preferences.skills(),
		queryFn: getSkillPreferences,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function setSkillPreferencesMutationOptions(
	queryClient: QueryClient,
	onSuccess?: (preferences: SkillPreferences) => void | Promise<void>,
) {
	return mutationOptions({
		mutationFn: setSkillPreferences,
		onSuccess: async (preferences) => {
			queryClient.setQueryData(
				queryKeys.preferences.skills(),
				preferences,
			);
			if (!preferences.enabled || preferences.mode === "manual") {
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
			if (!preferences.warnOnConflicts) {
				await queryClient.cancelQueries({
					queryKey: queryKeys.skills.copyStatuses(),
				});
				queryClient.removeQueries({
					queryKey: queryKeys.skills.copyStatuses(),
				});
			}
			await queryClient.invalidateQueries({
				queryKey: queryKeys.skills.lists(),
			});
			await onSuccess?.(preferences);
		},
	});
}

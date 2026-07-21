import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@heroui/react";
import {
	DEFAULT_USAGE_SETTINGS,
	getUsageSettings,
	saveUsageSettings,
	type UsageSettings,
} from "../lib/store";

/** Shared cache key for the persisted usage/ccusage preferences. */
const USAGE_SETTINGS_QUERY_KEY = ["usage-settings"] as const;

/** Reads the usage/ccusage preferences from the Tauri store. */
export function useUsageSettings() {
	return useQuery({
		queryKey: USAGE_SETTINGS_QUERY_KEY,
		queryFn: getUsageSettings,
	});
}

interface UsageSettingsChange {
	next: UsageSettings;
	previous: UsageSettings;
}

/**
 * Applies settings changes against the latest optimistic snapshot and persists
 * them in order. Dragging and stepping controls can emit several changes before
 * React renders again, so both properties are required to avoid stale writes.
 */
export function useUsageSettingsEditor() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const query = useUsageSettings();
	const saveQueueRef = useRef<Promise<void> | null>(null);
	const persistedSettingsRef = useRef<UsageSettings | null>(null);

	const mutation = useMutation({
		mutationFn: ({ next }: UsageSettingsChange) => {
			const queuedSave = saveQueueRef.current ?? Promise.resolve();
			const save = queuedSave.then(() => saveUsageSettings(next));
			saveQueueRef.current = save.then(
				() => undefined,
				() => undefined,
			);
			return save;
		},
		onSuccess: (saved, { next }) => {
			persistedSettingsRef.current = saved;
			if (queryClient.getQueryData(USAGE_SETTINGS_QUERY_KEY) === next) {
				queryClient.setQueryData(USAGE_SETTINGS_QUERY_KEY, saved);
			}
		},
		onError: (error, { next, previous }) => {
			if (queryClient.getQueryData(USAGE_SETTINGS_QUERY_KEY) === next) {
				queryClient.setQueryData(
					USAGE_SETTINGS_QUERY_KEY,
					persistedSettingsRef.current ?? previous,
				);
			}
			toast.danger(
				error instanceof Error
					? error.message
					: t("usageSettingsSaveError"),
			);
		},
	});

	const stageChange = (
		apply: (current: UsageSettings) => UsageSettings,
	): UsageSettingsChange => {
		const previous =
			queryClient.getQueryData<UsageSettings>(USAGE_SETTINGS_QUERY_KEY) ??
			query.data ??
			DEFAULT_USAGE_SETTINGS;
		if (persistedSettingsRef.current === null) {
			persistedSettingsRef.current = previous;
		}
		const next = apply(previous);
		queryClient.setQueryData(USAGE_SETTINGS_QUERY_KEY, next);
		return { next, previous };
	};
	const update = (apply: (current: UsageSettings) => UsageSettings) => {
		mutation.mutate(stageChange(apply));
	};
	const updateAsync = (apply: (current: UsageSettings) => UsageSettings) =>
		mutation.mutateAsync(stageChange(apply));

	return {
		...query,
		data: query.data ?? DEFAULT_USAGE_SETTINGS,
		isSaving: mutation.isPending,
		update,
		updateAsync,
	};
}

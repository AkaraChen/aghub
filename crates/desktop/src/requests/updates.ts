import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Update } from "@tauri-apps/plugin-updater";
import {
	getAutoCheckUpdates,
	getUpdateChannel,
	setAutoCheckUpdates,
	setUpdateChannel,
	type UpdateChannel,
} from "../lib/store";
import { queryKeys } from "./keys";

const UPDATE_CHECK_SESSION_KEY = "aghub-auto-update-check-session";

type UpdateMetadata = ConstructorParameters<typeof Update>[0];

export async function checkForUpdate(): Promise<Update | null> {
	const channel = await getUpdateChannel();
	const metadata = await invoke<UpdateMetadata | null>("check_for_update", {
		channel,
	});
	return metadata ? new Update(metadata) : null;
}

async function checkForStartupUpdate(): Promise<Update | null> {
	if (typeof window !== "undefined") {
		try {
			if (window.sessionStorage.getItem(UPDATE_CHECK_SESSION_KEY)) {
				return null;
			}
			window.sessionStorage.setItem(UPDATE_CHECK_SESSION_KEY, "1");
		} catch {
			// Continue when session storage is unavailable. React Query still
			// deduplicates the check mounted in this renderer session.
		}
	}

	if (!(await getAutoCheckUpdates())) {
		return null;
	}

	return checkForUpdate();
}

export function startupUpdateQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.updates.startup(),
		queryFn: checkForStartupUpdate,
		staleTime: Infinity,
		gcTime: Infinity,
		retry: false,
	});
}

export function autoCheckUpdatesQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.updates.autoCheck(),
		queryFn: getAutoCheckUpdates,
	});
}

export function updateChannelQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.updates.channel(),
		queryFn: getUpdateChannel,
	});
}

interface AutoCheckUpdatesMutationParams {
	queryClient: QueryClient;
	onSuccess?: (enabled: boolean) => void | Promise<void>;
}

export function setAutoCheckUpdatesMutationOptions({
	queryClient,
	onSuccess,
}: AutoCheckUpdatesMutationParams) {
	return mutationOptions({
		mutationFn: setAutoCheckUpdates,
		onSuccess: async (enabled) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.updates.autoCheck(),
			});
			await onSuccess?.(enabled);
		},
	});
}

interface UpdateChannelMutationParams {
	queryClient: QueryClient;
	onSuccess?: (channel: UpdateChannel) => void | Promise<void>;
}

export function setUpdateChannelMutationOptions({
	queryClient,
	onSuccess,
}: UpdateChannelMutationParams) {
	return mutationOptions({
		mutationFn: setUpdateChannel,
		onSuccess: async (channel) => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.updates.channel(),
			});
			await onSuccess?.(channel);
		},
	});
}

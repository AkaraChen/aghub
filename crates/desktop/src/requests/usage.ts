import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	InstallCcusageRuntimeRequest,
	SetCcusageRuntimeRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface UsageSummaryQueryParams {
	api: ApiClient;
	since?: string;
	until?: string;
	timezone?: string;
	/** ccusage pricing source: `true` = cached (`--offline`), `false` = live. */
	offline?: boolean;
	/** ccusage config file path (`--config`); empty/undefined = none. */
	config?: string;
	/** ccusage request timeout, in seconds. */
	timeoutSecs?: number;
	/** Raw extra ccusage flags appended verbatim; empty/undefined = none. */
	args?: string;
	enabled?: boolean;
	/** Background poll interval in ms; `false` (default) polls only on demand. */
	refetchInterval?: number | false;
}

export function usageSummaryQueryOptions({
	api,
	since,
	until,
	timezone,
	offline,
	config,
	timeoutSecs,
	args,
	enabled = true,
	refetchInterval = false,
}: UsageSummaryQueryParams) {
	return queryOptions({
		queryKey: queryKeys.usage.summary(
			since ?? null,
			until ?? null,
			timezone ?? null,
			offline ?? null,
			config || null,
			timeoutSecs ?? null,
			args || null,
		),
		queryFn: () =>
			api.usage.summary({
				since,
				until,
				timezone,
				offline,
				config,
				timeoutSecs,
				args,
			}),
		enabled,
		staleTime: 5 * 60_000,
		refetchInterval,
		// Usage is optional: the backend route only exists once #193 lands, and
		// the report degrades per-agent on its own. Don't retry a missing
		// endpoint — let the page hide the section instead of spinning.
		retry: false,
	});
}

interface UsageLimitsQueryParams {
	api: ApiClient;
	enabled?: boolean;
	/** Background poll interval in ms; `false` (default) polls only on demand. */
	refetchInterval?: number | false;
}

export function usageLimitsQueryOptions({
	api,
	enabled = true,
	refetchInterval = false,
}: UsageLimitsQueryParams) {
	return queryOptions({
		queryKey: queryKeys.usage.limits(),
		queryFn: () => api.usage.limits(),
		enabled,
		staleTime: 60_000,
		refetchInterval,
		retry: false,
	});
}

/** ccusage runtime version, health, and update hint for the status panel. */
export function usageStatusQueryOptions({
	api,
	enabled = true,
}: {
	api: ApiClient;
	enabled?: boolean;
}) {
	return queryOptions({
		queryKey: queryKeys.usage.status(),
		queryFn: () => api.usage.status(),
		enabled,
		staleTime: 5 * 60_000,
		retry: false,
	});
}

export function usageRuntimeQueryOptions({ api }: { api: ApiClient }) {
	return queryOptions({
		queryKey: queryKeys.usage.runtime(),
		queryFn: () => api.usage.runtime(),
		staleTime: 60_000,
		retry: false,
	});
}

async function invalidateUsageRuntime(queryClient: QueryClient) {
	await Promise.all([
		queryClient.invalidateQueries({
			queryKey: queryKeys.usage.summaries(),
		}),
		queryClient.invalidateQueries({ queryKey: queryKeys.usage.status() }),
	]);
}

async function invalidateUsageRuntimeState(queryClient: QueryClient) {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: queryKeys.usage.runtime() }),
		invalidateUsageRuntime(queryClient),
	]);
}

export function setUsageRuntimeMutationOptions({
	api,
	queryClient,
}: {
	api: ApiClient;
	queryClient: QueryClient;
}) {
	return mutationOptions({
		mutationFn: (body: SetCcusageRuntimeRequest) =>
			api.usage.setRuntime(body),
		onError: async () => {
			await invalidateUsageRuntimeState(queryClient);
		},
		onSuccess: async (runtime) => {
			queryClient.setQueryData(queryKeys.usage.runtime(), runtime);
			await invalidateUsageRuntime(queryClient);
		},
	});
}

export function installUsageRuntimeMutationOptions({
	api,
	queryClient,
}: {
	api: ApiClient;
	queryClient: QueryClient;
}) {
	return mutationOptions({
		mutationFn: (body: InstallCcusageRuntimeRequest) =>
			api.usage.installRuntime(body),
		onError: async () => {
			await invalidateUsageRuntimeState(queryClient);
		},
		onSuccess: async (runtime) => {
			queryClient.setQueryData(queryKeys.usage.runtime(), runtime);
			await invalidateUsageRuntime(queryClient);
		},
	});
}

export function updateUsageRuntimeMutationOptions({
	api,
	queryClient,
}: {
	api: ApiClient;
	queryClient: QueryClient;
}) {
	return mutationOptions({
		mutationFn: () => api.usage.updateRuntime(),
		onError: async () => {
			await invalidateUsageRuntimeState(queryClient);
		},
		onSuccess: async (runtime) => {
			queryClient.setQueryData(queryKeys.usage.runtime(), runtime);
			await invalidateUsageRuntime(queryClient);
		},
	});
}

export function refreshUsageRuntimeMutationOptions({
	api,
	queryClient,
}: {
	api: ApiClient;
	queryClient: QueryClient;
}) {
	return mutationOptions({
		mutationFn: () => api.usage.refreshRuntime(),
		onError: async () => {
			await invalidateUsageRuntimeState(queryClient);
		},
		onSuccess: async (runtime) => {
			queryClient.setQueryData(queryKeys.usage.runtime(), runtime);
			await invalidateUsageRuntime(queryClient);
		},
	});
}

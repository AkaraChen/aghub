import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CcusageRuntimeDto,
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
	/**
	 * Additional ccusage arguments. The API splits on whitespace, so one value
	 * cannot contain spaces.
	 */
	args?: string;
	/** Canonical aghub agent ids to probe. Empty disables all probes. */
	agents?: readonly string[];
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
	agents,
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
			agents?.join(",") ?? null,
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
				agents,
			}),
		enabled,
		staleTime: 5 * 60_000,
		refetchInterval,
		// The report already degrades individual agent failures into warnings.
		// Surface request-level failures instead of hiding them behind retries.
		retry: false,
	});
}

export function usageAgentsQueryOptions({
	api,
	enabled = true,
}: {
	api: ApiClient;
	enabled?: boolean;
}) {
	return queryOptions({
		queryKey: queryKeys.usage.agents(),
		queryFn: () => api.usage.agents(),
		enabled,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

interface UsageLimitsQueryParams {
	api: ApiClient;
	agents?: readonly string[];
	enabled?: boolean;
	/** Background poll interval in ms; `false` (default) polls only on demand. */
	refetchInterval?: number | false;
}

export function usageLimitsQueryOptions({
	api,
	agents,
	enabled = true,
	refetchInterval = false,
}: UsageLimitsQueryParams) {
	return queryOptions({
		queryKey: queryKeys.usage.limits(agents?.join(",") ?? null),
		queryFn: () => api.usage.limits(agents),
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

function usageRuntimeMutationOptions<TVariables>({
	queryClient,
	mutationFn,
}: {
	queryClient: QueryClient;
	mutationFn: (variables: TVariables) => Promise<CcusageRuntimeDto>;
}) {
	return mutationOptions({
		mutationFn,
		onError: async () => {
			await invalidateUsageRuntimeState(queryClient);
		},
		onSuccess: async (runtime) => {
			queryClient.setQueryData(queryKeys.usage.runtime(), runtime);
			await invalidateUsageRuntime(queryClient);
		},
	});
}

export function setUsageRuntimeMutationOptions({
	api,
	queryClient,
}: {
	api: ApiClient;
	queryClient: QueryClient;
}) {
	return usageRuntimeMutationOptions({
		queryClient,
		mutationFn: (body: SetCcusageRuntimeRequest) =>
			api.usage.setRuntime(body),
	});
}

export function installUsageRuntimeMutationOptions({
	api,
	queryClient,
}: {
	api: ApiClient;
	queryClient: QueryClient;
}) {
	return usageRuntimeMutationOptions({
		queryClient,
		mutationFn: (body: InstallCcusageRuntimeRequest) =>
			api.usage.installRuntime(body),
	});
}

export function updateUsageRuntimeMutationOptions({
	api,
	queryClient,
}: {
	api: ApiClient;
	queryClient: QueryClient;
}) {
	return usageRuntimeMutationOptions({
		queryClient,
		mutationFn: () => api.usage.updateRuntime(),
	});
}

export function refreshUsageRuntimeMutationOptions({
	api,
	queryClient,
}: {
	api: ApiClient;
	queryClient: QueryClient;
}) {
	return usageRuntimeMutationOptions({
		queryClient,
		mutationFn: () => api.usage.refreshRuntime(),
	});
}

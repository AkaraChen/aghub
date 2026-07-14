import { queryOptions } from "@tanstack/react-query";
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

/** ccusage sidecar version + health + update hint, for the status panel. */
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

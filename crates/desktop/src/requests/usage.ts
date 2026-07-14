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
		),
		queryFn: () =>
			api.usage.summary({
				since,
				until,
				timezone,
				offline,
				config,
				timeoutSecs,
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

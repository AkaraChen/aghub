import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface UsageSummaryQueryParams {
	api: ApiClient;
	since?: string;
	until?: string;
	timezone?: string;
	enabled?: boolean;
}

export function usageSummaryQueryOptions({
	api,
	since,
	until,
	timezone,
	enabled = true,
}: UsageSummaryQueryParams) {
	return queryOptions({
		queryKey: queryKeys.usage.summary(
			since ?? null,
			until ?? null,
			timezone ?? null,
		),
		queryFn: () => api.usage.summary({ since, until, timezone }),
		enabled,
		staleTime: 5 * 60_000,
		// Usage is optional: the backend route only exists once #193 lands, and
		// the report degrades per-agent on its own. Don't retry a missing
		// endpoint — let the page hide the section instead of spinning.
		retry: false,
	});
}

interface UsageLimitsQueryParams {
	api: ApiClient;
	enabled?: boolean;
}

export function usageLimitsQueryOptions({
	api,
	enabled = true,
}: UsageLimitsQueryParams) {
	return queryOptions({
		queryKey: queryKeys.usage.limits(),
		queryFn: () => api.usage.limits(),
		enabled,
		staleTime: 60_000,
		retry: false,
	});
}

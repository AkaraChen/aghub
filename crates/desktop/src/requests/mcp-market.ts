import { infiniteQueryOptions } from "@tanstack/react-query";
import type { MarketMcpPage } from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

const SEARCH_LIMIT = 60;

interface McpMarketSearchQueryParams {
	api: ApiClient;
	query: string;
	/** Public Registry API endpoint; null selects MCP Registry. */
	registryUrl?: string | null;
	enabled?: boolean;
	staleTime?: number;
}

export function mcpMarketSearchQueryOptions({
	api,
	query,
	registryUrl = null,
	enabled = true,
	staleTime = 60_000,
}: McpMarketSearchQueryParams) {
	return infiniteQueryOptions({
		queryKey: queryKeys.mcpMarket.search(query, registryUrl),
		queryFn: ({
			pageParam,
		}: {
			pageParam: string | null;
		}): Promise<MarketMcpPage> =>
			api.mcpMarket.search(
				query,
				SEARCH_LIMIT,
				registryUrl ?? undefined,
				pageParam ?? undefined,
			),
		initialPageParam: null as string | null,
		getNextPageParam: (page: MarketMcpPage) =>
			page.next_cursor || undefined,
		enabled,
		staleTime,
	});
}

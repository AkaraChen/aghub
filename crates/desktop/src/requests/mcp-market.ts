import { queryOptions } from "@tanstack/react-query";
import type { MarketMcpServer } from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

const SEARCH_LIMIT = 60;

interface McpMarketSearchQueryParams {
	api: ApiClient;
	query: string;
	/** Custom registry URL (official-API compatible); null = official. */
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
	return queryOptions({
		queryKey: queryKeys.mcpMarket.search(query, registryUrl),
		queryFn: (): Promise<MarketMcpServer[]> =>
			api.mcpMarket.search(query, SEARCH_LIMIT, registryUrl ?? undefined),
		enabled,
		staleTime,
	});
}

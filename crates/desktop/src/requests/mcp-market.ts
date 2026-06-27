import { queryOptions } from "@tanstack/react-query";
import type { MarketMcpServer } from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

const SEARCH_LIMIT = 60;

interface McpMarketSearchQueryParams {
	api: ApiClient;
	query: string;
	enabled?: boolean;
	staleTime?: number;
}

export function mcpMarketSearchQueryOptions({
	api,
	query,
	enabled = true,
	staleTime = 60_000,
}: McpMarketSearchQueryParams) {
	return queryOptions({
		queryKey: queryKeys.mcpMarket.search(query),
		queryFn: (): Promise<MarketMcpServer[]> =>
			api.mcpMarket.search(query, SEARCH_LIMIT),
		enabled,
		staleTime,
	});
}

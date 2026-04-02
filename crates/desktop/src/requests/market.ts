import { infiniteQueryOptions } from "@tanstack/react-query";
import type { MarketSkill } from "../lib/api-types";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

const FETCH_SIZE = 100;
const MAX_TOTAL = 1000;

interface MarketSearchQueryParams {
	api: ApiClient;
	query: string;
	enabled?: boolean;
	staleTime?: number;
}

export function marketSearchInfiniteQueryOptions({
	api,
	query,
	enabled = true,
	staleTime = 60_000,
}: MarketSearchQueryParams) {
	return infiniteQueryOptions({
		queryKey: queryKeys.market.search(query),
		queryFn: async ({ pageParam }: { pageParam: number }) => {
			const offset = pageParam;
			const limit = Math.min(FETCH_SIZE, MAX_TOTAL - offset);
			const actualLimit = offset + limit;
			const results = await api.market.search(query, actualLimit);
			return results.slice(offset, actualLimit);
		},
		initialPageParam: 0,
		getNextPageParam: (
			lastPage: MarketSkill[],
			allPages: MarketSkill[][],
		) => {
			const totalFetched = allPages.reduce(
				(sum, page) => sum + page.length,
				0,
			);
			if (lastPage.length < FETCH_SIZE || totalFetched >= MAX_TOTAL) {
				return undefined;
			}
			return totalFetched;
		},
		enabled,
		staleTime,
	});
}

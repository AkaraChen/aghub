import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import {
	addMcpRegistry,
	getMcpRegistries,
	type McpRegistrySource,
	removeMcpRegistry,
} from "../lib/store";
import { queryKeys } from "./keys";
import type { ApiClient } from "./client";

export function mcpRegistriesQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.mcpRegistries.list(),
		queryFn: getMcpRegistries,
	});
}

async function invalidateMcpRegistries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.mcpRegistries.all(),
	});
}

interface AddMcpRegistryMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
}

export function addMcpRegistryMutationOptions({
	api,
	queryClient,
}: AddMcpRegistryMutationParams) {
	return mutationOptions({
		mutationFn: async (source: Omit<McpRegistrySource, "id">) => {
			await api.mcpMarket.search("", 1, source.url);
			return addMcpRegistry(source);
		},
		onSuccess: () => invalidateMcpRegistries(queryClient),
	});
}

export function removeMcpRegistryMutationOptions(queryClient: QueryClient) {
	return mutationOptions({
		mutationFn: removeMcpRegistry,
		onSuccess: () => invalidateMcpRegistries(queryClient),
	});
}

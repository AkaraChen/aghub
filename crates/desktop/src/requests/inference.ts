import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type { ProviderTransferResponseDto } from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface OpenCodeProvidersQueryParams {
	api: ApiClient;
	enabled?: boolean;
}

export function openCodeProvidersQueryOptions({
	api,
	enabled = true,
}: OpenCodeProvidersQueryParams) {
	return queryOptions({
		queryKey: queryKeys.inference.openCodeProviders(),
		queryFn: () => api.inference.listOpenCodeProviders(),
		enabled,
	});
}

export async function invalidateInferenceQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.inference.all(),
	});
}

interface TransferProvidersMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: ProviderTransferResponseDto) => void | Promise<void>;
}

export function transferProvidersMutationOptions({
	api,
	queryClient,
	onSuccess,
}: TransferProvidersMutationParams) {
	return mutationOptions({
		mutationFn: () => api.inference.transferOpenCodeToCodex(),
		onSuccess: async (data) => {
			await invalidateInferenceQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

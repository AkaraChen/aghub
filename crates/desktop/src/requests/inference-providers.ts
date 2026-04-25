import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CreateInferenceProviderRequest,
	InferenceProviderResponse,
	UpdateInferenceProviderRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface InferenceProviderListQueryParams {
	api: ApiClient;
	enabled?: boolean;
	staleTime?: number;
}

export function inferenceProviderListQueryOptions({
	api,
	enabled = true,
	staleTime = 30_000,
}: InferenceProviderListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.inferenceProviders.list(),
		queryFn: () => api.inferenceProviders.list(),
		enabled,
		staleTime,
	});
}

export async function invalidateInferenceProviderQueries(
	queryClient: QueryClient,
) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.inferenceProviders.all(),
	});
}

interface CreateInferenceProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: InferenceProviderResponse) => void | Promise<void>;
}

export function createInferenceProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateInferenceProviderMutationParams) {
	return mutationOptions({
		mutationFn: (body: CreateInferenceProviderRequest) =>
			api.inferenceProviders.create(body),
		onSuccess: async (data) => {
			await invalidateInferenceProviderQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface UpdateInferenceProviderVariables {
	name: string;
	body: UpdateInferenceProviderRequest;
}

interface UpdateInferenceProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: InferenceProviderResponse,
		variables: UpdateInferenceProviderVariables,
	) => void | Promise<void>;
}

export function updateInferenceProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateInferenceProviderMutationParams) {
	return mutationOptions({
		mutationFn: ({ name, body }: UpdateInferenceProviderVariables) =>
			api.inferenceProviders.update(name, body),
		onSuccess: async (data, variables) => {
			await invalidateInferenceProviderQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

interface DeleteInferenceProviderMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteInferenceProviderMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteInferenceProviderMutationParams) {
	return mutationOptions({
		mutationFn: (name: string) => api.inferenceProviders.delete(name),
		onSuccess: async () => {
			await invalidateInferenceProviderQueries(queryClient);
			await onSuccess?.();
		},
	});
}

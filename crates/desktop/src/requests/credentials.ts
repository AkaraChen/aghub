import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	CreateCredentialRequest,
	CredentialResponse,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface CredentialsQueryParams {
	api: ApiClient;
}

export function credentialsListQueryOptions({ api }: CredentialsQueryParams) {
	return queryOptions({
		queryKey: queryKeys.credentials.list(),
		queryFn: () => api.credentials.list(),
	});
}

export async function invalidateCredentialQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({
		queryKey: queryKeys.credentials.all(),
	});
}

interface CreateCredentialMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (data: CredentialResponse) => void | Promise<void>;
}

export function createCredentialMutationOptions({
	api,
	queryClient,
	onSuccess,
}: CreateCredentialMutationParams) {
	return mutationOptions({
		mutationFn: (body: CreateCredentialRequest) =>
			api.credentials.create(body),
		onSuccess: async (data) => {
			await invalidateCredentialQueries(queryClient);
			await onSuccess?.(data);
		},
	});
}

interface DeleteCredentialMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: () => void | Promise<void>;
}

export function deleteCredentialMutationOptions({
	api,
	queryClient,
	onSuccess,
}: DeleteCredentialMutationParams) {
	return mutationOptions({
		mutationFn: (id: string) => api.credentials.delete(id),
		onSuccess: async () => {
			await invalidateCredentialQueries(queryClient);
			await onSuccess?.();
		},
	});
}

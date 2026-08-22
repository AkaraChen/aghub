import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import type {
	RuleFileContentResponse,
	UpdateRuleContentRequest,
} from "../generated/dto";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

type RuleScope = "global" | "project" | "all";

interface RuleListQueryParams {
	api: ApiClient;
	scope?: RuleScope;
	projectRoot?: string;
	enabled?: boolean;
	staleTime?: number;
}

export function ruleListQueryOptions({
	api,
	scope = "global",
	projectRoot,
	enabled = true,
	staleTime = 30_000,
}: RuleListQueryParams) {
	return queryOptions({
		queryKey: queryKeys.rules.list(scope, projectRoot),
		queryFn: () => api.rules.listAll(scope, projectRoot),
		enabled,
		staleTime,
	});
}

interface RuleContentQueryParams {
	api: ApiClient;
	path: string;
	scope?: RuleScope;
	projectRoot?: string;
	enabled?: boolean;
}

export function ruleContentQueryOptions({
	api,
	path,
	scope = "global",
	projectRoot,
	enabled = true,
}: RuleContentQueryParams) {
	return queryOptions({
		queryKey: queryKeys.rules.content(path, scope, projectRoot),
		queryFn: () => api.rules.getContent(path, scope, projectRoot),
		enabled,
	});
}

export function ruleVersionsQueryOptions({
	api,
	path,
	scope = "global",
	projectRoot,
	enabled = true,
}: RuleContentQueryParams) {
	return queryOptions({
		queryKey: queryKeys.rules.versions(path, scope, projectRoot),
		queryFn: () => api.rules.listVersions(path, scope, projectRoot),
		enabled,
	});
}

export function ruleVersionStorageQueryOptions({ api }: { api: ApiClient }) {
	return queryOptions({
		queryKey: queryKeys.rules.storage(),
		queryFn: () => api.rules.storage(),
	});
}

export async function invalidateRuleQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({ queryKey: queryKeys.rules.all() });
}

interface UpdateRuleContentMutationParams {
	api: ApiClient;
	queryClient: QueryClient;
	onSuccess?: (
		data: RuleFileContentResponse,
		variables: UpdateRuleContentRequest,
	) => void | Promise<void>;
}

export function updateRuleContentMutationOptions({
	api,
	queryClient,
	onSuccess,
}: UpdateRuleContentMutationParams) {
	return mutationOptions({
		mutationFn: (body: UpdateRuleContentRequest) =>
			api.rules.updateContent(body),
		onSuccess: async (data, variables) => {
			await invalidateRuleQueries(queryClient);
			await onSuccess?.(data, variables);
		},
	});
}

export function clearRuleVersionsMutationOptions({
	api,
	queryClient,
}: {
	api: ApiClient;
	queryClient: QueryClient;
}) {
	return mutationOptions({
		mutationFn: () => api.rules.clearVersions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: queryKeys.rules.all() }),
	});
}

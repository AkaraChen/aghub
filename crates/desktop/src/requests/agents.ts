import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";
import { getDisabledAgents } from "../lib/store";

interface AgentsQueryParams {
	api: ApiClient;
}

export function agentsListQueryOptions({ api }: AgentsQueryParams) {
	return queryOptions({
		queryKey: queryKeys.agents.list(),
		queryFn: () => api.agents.list(),
	});
}

export function agentAvailabilityQueryOptions({ api }: AgentsQueryParams) {
	return queryOptions({
		queryKey: queryKeys.agents.availability(),
		queryFn: () => api.agents.availability(),
	});
}

export function disabledAgentsQueryOptions() {
	return queryOptions({
		queryKey: queryKeys.agents.disabledAgents(),
		queryFn: () => getDisabledAgents(),
	});
}

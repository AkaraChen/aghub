import { useSuspenseQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";
import type { McpResponse } from "../lib/api-types";
import { useServer } from "./use-server";

export function useMcps() {
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);

	return useSuspenseQuery<McpResponse[]>({
		queryKey: ["mcps", "all", "global"],
		queryFn: () => api.mcps.listAll("global"),
		staleTime: 30_000,
	});
}

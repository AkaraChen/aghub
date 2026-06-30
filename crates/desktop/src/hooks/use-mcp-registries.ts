import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	addMcpRegistry,
	getMcpRegistries,
	type McpRegistrySource,
	removeMcpRegistry,
} from "../lib/store";

const QUERY_KEY = ["mcp-registries"] as const;

export function useMcpRegistries() {
	return useQuery<McpRegistrySource[]>({
		queryKey: QUERY_KEY,
		queryFn: getMcpRegistries,
	});
}

export function useAddMcpRegistry() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: addMcpRegistry,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
	});
}

export function useRemoveMcpRegistry() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: removeMcpRegistry,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
	});
}

import { useQuery } from "@tanstack/react-query";
import type { AgentInfo } from "../generated/dto";
import { resolveAgentConfigPath } from "../lib/agent-config-paths";

/**
 * Resolves the on-disk config path we can hand to `revealItemInDir` for an
 * agent. Local filesystem resolution (not an HTTP request), so it lives in a
 * hook rather than the `requests/` api layer.
 */
export function useAgentConfigPath(agent: AgentInfo) {
	return useQuery({
		queryKey: ["agent-config-path", agent.id],
		queryFn: () => resolveAgentConfigPath(agent),
		staleTime: Infinity,
	});
}

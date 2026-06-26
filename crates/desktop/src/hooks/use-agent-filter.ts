import { useQueryState } from "nuqs";
import { useMemo } from "react";
import { setStickyAgentFilter } from "./use-sticky-agent-filter";

/**
 * Agent filter shared by the resource list pages (skills / MCP / sub-agents).
 * The `?agent=` URL state is the source of truth; every change is mirrored
 * into the sticky store so the sidebar can restore the filter across
 * navigations. `filtered` narrows a list to the selected agent.
 */
export function useAgentFilter<T extends { agent: string | null }>(items: T[]) {
	const [agentId, setAgentIdRaw] = useQueryState("agent");

	function setAgentId(next: string | null) {
		setAgentIdRaw(next);
		setStickyAgentFilter(next);
	}

	const filtered = useMemo(
		() =>
			agentId ? items.filter((item) => item.agent === agentId) : items,
		[items, agentId],
	);

	return { agentId, setAgentId, filtered };
}

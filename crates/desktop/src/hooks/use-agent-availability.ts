import { use } from "react";
import { AgentAvailabilityContext } from "../contexts/agent-availability";
import type { AgentAvailabilityContextValue } from "../contexts/agent-availability";

export function useAgentAvailability(): AgentAvailabilityContextValue {
	const ctx = use(AgentAvailabilityContext);
	if (!ctx)
		throw new Error(
			"useAgentAvailability must be used within <AgentAvailabilityProvider>",
		);
	return ctx;
}

import type { AvailableAgent } from "../contexts/agent-availability";

export type AgentStatus = "ready" | "missing" | "disabled";

export function agentStatus(agent: AvailableAgent): AgentStatus {
	if (agent.isDisabled) return "disabled";
	if (!agent.isDetected) return "missing";
	return "ready";
}

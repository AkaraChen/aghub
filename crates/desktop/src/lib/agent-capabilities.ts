import type { AgentInfo } from "../generated/dto/AgentInfo";

export function supportsMcp(agent: Pick<AgentInfo, "capabilities">): boolean {
	return agent.capabilities.mcp_stdio || agent.capabilities.mcp_remote;
}

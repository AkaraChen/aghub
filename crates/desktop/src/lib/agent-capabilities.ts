import type { AgentInfo, TransportDto } from "../generated/dto";

export type AgentScope = "global" | "project";

export function supportsMcp(agent: Pick<AgentInfo, "capabilities">): boolean {
	return (
		agent.capabilities.mcp.scopes.global ||
		agent.capabilities.mcp.scopes.project
	);
}

export function supportsMcpScope(
	agent: Pick<AgentInfo, "capabilities">,
	scope: AgentScope,
): boolean {
	return agent.capabilities.mcp.scopes[scope];
}

export function supportsMcpTransport(
	agent: Pick<AgentInfo, "capabilities">,
	transport: TransportDto | undefined,
): boolean {
	if (!transport) return false;
	if (transport.type === "stdio") return agent.capabilities.mcp.stdio;
	return agent.capabilities.mcp.remote;
}

export function supportsSkill(agent: Pick<AgentInfo, "capabilities">): boolean {
	return (
		agent.capabilities.skills.scopes.global ||
		agent.capabilities.skills.scopes.project
	);
}

export function supportsSkillScope(
	agent: Pick<AgentInfo, "capabilities">,
	scope: AgentScope,
): boolean {
	return agent.capabilities.skills.scopes[scope];
}

export function supportsSkillMutation(
	agent: Pick<AgentInfo, "capabilities">,
	scope: AgentScope,
): boolean {
	return scope === "global"
		? agent.capabilities.skills.mutable_global
		: agent.capabilities.skills.mutable_project;
}

export function supportsSubAgent(
	agent: Pick<AgentInfo, "capabilities">,
): boolean {
	return (
		agent.capabilities.sub_agents.scopes.global ||
		agent.capabilities.sub_agents.scopes.project
	);
}

export function supportsSubAgentScope(
	agent: Pick<AgentInfo, "capabilities">,
	scope: AgentScope,
): boolean {
	return agent.capabilities.sub_agents.scopes[scope];
}


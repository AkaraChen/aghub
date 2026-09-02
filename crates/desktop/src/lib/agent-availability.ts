import type { AgentAvailabilityDto, AgentInfo } from "../generated/dto";

export function isAgentDetected(availability: AgentAvailabilityDto): boolean {
	return availability.state === "detected";
}

export function canPrepareAgentConfiguration(
	agent: AgentInfo,
	isDisabled: boolean,
): boolean {
	if (isDisabled) return false;
	const { skills, mcp, sub_agents: subAgents } = agent.capabilities;
	return (
		skills.mutable_global ||
		skills.mutable_project ||
		mcp.scopes.global ||
		mcp.scopes.project ||
		subAgents.scopes.global ||
		subAgents.scopes.project
	);
}

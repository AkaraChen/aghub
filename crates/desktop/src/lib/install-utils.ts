import { UNIVERSAL_SKILL_TARGET_ID } from "./skill-targets";

export interface InstallResult {
	agentId: string;
	displayName: string;
	status: "pending" | "success" | "error";
	error?: string;
}

export function buildPendingResults(
	selectedAgents: Set<string>,
	compatibleAgents: Array<{ id: string; display_name: string }>,
	universalDisplayName = "Universal agents",
): InstallResult[] {
	return Array.from(selectedAgents, (agentId) => {
		const agent = compatibleAgents.find((item) => item.id === agentId);
		return {
			agentId,
			displayName:
				agentId === UNIVERSAL_SKILL_TARGET_ID
					? universalDisplayName
					: (agent?.display_name ?? agentId),
			status: "pending" as const,
		};
	});
}

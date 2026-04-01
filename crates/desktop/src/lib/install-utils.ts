export interface InstallResult {
	agentId: string;
	displayName: string;
	status: "pending" | "success" | "error";
	error?: string;
}

export function buildPendingResults(
	selectedAgents: Set<string>,
	compatibleAgents: Array<{ id: string; display_name: string }>,
): InstallResult[] {
	return Array.from(selectedAgents, (agentId) => {
		const agent = compatibleAgents.find((item) => item.id === agentId);
		return {
			agentId,
			displayName: agent?.display_name ?? agentId,
			status: "pending" as const,
		};
	});
}

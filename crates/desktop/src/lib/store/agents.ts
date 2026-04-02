import { getStore } from ".";

export async function getDisabledAgents(): Promise<string[]> {
	const store = await getStore();
	return (await store.get<string[]>("disabledAgents")) ?? [];
}

async function setDisabledAgents(agentIds: string[]): Promise<void> {
	const store = await getStore();
	await store.set("disabledAgents", agentIds);
	await store.save();
}

export async function disableAgent(agentId: string): Promise<void> {
	const disabled = await getDisabledAgents();
	if (!disabled.includes(agentId)) {
		await setDisabledAgents([...disabled, agentId]);
	}
}

export async function enableAgent(agentId: string): Promise<void> {
	const disabled = await getDisabledAgents();
	await setDisabledAgents(disabled.filter((id) => id !== agentId));
}

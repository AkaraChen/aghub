import { getStore } from ".";
import type { McpRegistrySource } from "./types";

const KEY = "mcpRegistries";

export async function getMcpRegistries(): Promise<McpRegistrySource[]> {
	const store = await getStore();
	return (await store.get<McpRegistrySource[]>(KEY)) ?? [];
}

export async function addMcpRegistry(
	source: Omit<McpRegistrySource, "id">,
): Promise<McpRegistrySource> {
	const store = await getStore();
	const sources = (await store.get<McpRegistrySource[]>(KEY)) ?? [];
	const created: McpRegistrySource = { ...source, id: crypto.randomUUID() };
	await store.set(KEY, [...sources, created]);
	await store.save();
	return created;
}

export async function removeMcpRegistry(id: string): Promise<void> {
	const store = await getStore();
	const sources = (await store.get<McpRegistrySource[]>(KEY)) ?? [];
	await store.set(
		KEY,
		sources.filter((source) => source.id !== id),
	);
	await store.save();
}

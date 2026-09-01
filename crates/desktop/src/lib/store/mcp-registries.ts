import { getStore } from ".";
import type { McpRegistrySource } from "./types";

const KEY = "mcpRegistries";
let mutationQueue: Promise<void> = Promise.resolve();

interface McpRegistryMutation<T> {
	next: McpRegistrySource[] | null;
	result: T;
}

function mutateMcpRegistries<T>(
	mutation: (sources: McpRegistrySource[]) => McpRegistryMutation<T>,
): Promise<T> {
	const operation = mutationQueue.then(async () => {
		const store = await getStore();
		const sources = (await store.get<McpRegistrySource[]>(KEY)) ?? [];
		const { next, result } = mutation(sources);
		if (next) {
			await store.set(KEY, next);
			await store.save();
		}
		return result;
	});
	mutationQueue = operation.then(
		() => undefined,
		() => undefined,
	);
	return operation;
}

export async function getMcpRegistries(): Promise<McpRegistrySource[]> {
	const store = await getStore();
	return (await store.get<McpRegistrySource[]>(KEY)) ?? [];
}

export async function addMcpRegistry(
	source: Omit<McpRegistrySource, "id">,
): Promise<McpRegistrySource> {
	return mutateMcpRegistries((sources) => {
		const existing = sources.find((item) => item.url === source.url);
		if (existing) return { next: null, result: existing };
		const created: McpRegistrySource = {
			...source,
			id: crypto.randomUUID(),
		};
		return { next: [...sources, created], result: created };
	});
}

export async function removeMcpRegistry(id: string): Promise<void> {
	return mutateMcpRegistries((sources) => ({
		next: sources.filter((source) => source.id !== id),
		result: undefined,
	}));
}

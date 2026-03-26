import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import stableHash from "stable-hash";
import { twMerge } from "tailwind-merge";
import type { TransportDto } from "./api-types";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function getMcpMergeKey(transport: TransportDto): string {
	let key: unknown;

	switch (transport.type) {
		case "stdio":
			key = {
				type: "stdio",
				command: transport.command,
				args: transport.args ? [...transport.args].sort() : [],
				env: transport.env
					? Object.entries(transport.env)
							.sort(([a], [b]) => a.localeCompare(b))
							.reduce(
								(acc, [k, v]) => ({ ...acc, [k]: v }),
								{} as Record<string, string>,
							)
					: {},
			};
			break;
		case "sse":
		case "streamable_http":
			key = {
				type: transport.type,
				url: transport.url,
				headers: transport.headers
					? Object.entries(transport.headers)
							.sort(([a], [b]) => a.localeCompare(b))
							.reduce(
								(acc, [k, v]) => ({ ...acc, [k]: v }),
								{} as Record<string, string>,
							)
					: {},
			};
			break;
	}

	return stableHash(key);
}

import type { AgentInfo } from "./api";

export function sortAgents(agents: string[], allAgents: AgentInfo[]): string[] {
	const orderMap = new Map(allAgents.map((a, i) => [a.id, i]));
	return [...agents].sort((a, b) => {
		const indexA = orderMap.get(a) ?? -1;
		const indexB = orderMap.get(b) ?? -1;
		if (indexA === -1 && indexB === -1) return a.localeCompare(b);
		if (indexA === -1) return 1;
		if (indexB === -1) return -1;
		return indexA - indexB;
	});
}

export function sortAgentObjects<T extends { agent?: string | null }>(
	items: T[],
	allAgents: AgentInfo[],
): T[] {
	const orderMap = new Map(allAgents.map((a, i) => [a.id, i]));
	return [...items].sort((a, b) => {
		const idA = a.agent ?? "default";
		const idB = b.agent ?? "default";
		const indexA = orderMap.get(idA) ?? -1;
		const indexB = orderMap.get(idB) ?? -1;
		if (indexA === -1 && indexB === -1) return idA.localeCompare(idB);
		if (indexA === -1) return 1;
		if (indexB === -1) return -1;
		return indexA - indexB;
	});
}

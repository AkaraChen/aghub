import type {
	MarketMcpInstallMethod,
	MarketMcpServer,
	McpResponse,
} from "../generated/dto";
import type { McpGroup } from "../components/mcp-detail";
import { marketMcpMethodMatchesTransport } from "./mcp-market-utils";
import type { Project } from "./store";
import { getMcpMergeKey } from "./utils";

export interface McpInventoryTarget {
	id: string;
	scope: "global" | "project";
	projectName: string | null;
	projectRoot: string | null;
	items: McpResponse[];
}

export interface MarketMcpInstalledLocation {
	id: string;
	target: McpInventoryTarget;
	method: MarketMcpInstallMethod;
	group: McpGroup;
}

function scopedItems(
	items: McpResponse[],
	scope: McpInventoryTarget["scope"],
): McpResponse[] {
	return items.map((item) => ({ ...item, source: scope }));
}

export function buildMcpInventory(
	globalItems: McpResponse[],
	projects: Project[],
	projectItems: McpResponse[][],
): McpInventoryTarget[] {
	return [
		{
			id: "global",
			scope: "global",
			projectName: null,
			projectRoot: null,
			items: scopedItems(globalItems, "global"),
		},
		...projects.map((project, index) => ({
			id: `project:${project.id}`,
			scope: "project" as const,
			projectName: project.name,
			projectRoot: project.path,
			items: scopedItems(projectItems[index] ?? [], "project"),
		})),
	];
}

export function installedLocationsForServer(
	server: MarketMcpServer,
	inventory: McpInventoryTarget[],
): MarketMcpInstalledLocation[] {
	const locations: MarketMcpInstalledLocation[] = [];

	for (const target of inventory) {
		const groups = new Map<string, McpResponse[]>();
		for (const item of target.items) {
			const matches = server.install_methods.some((method) =>
				marketMcpMethodMatchesTransport(method, item.transport),
			);
			if (!matches) continue;
			const mergeKey = getMcpMergeKey(item.transport);
			const group = groups.get(mergeKey) ?? [];
			group.push(item);
			groups.set(mergeKey, group);
		}

		for (const [mergeKey, items] of groups) {
			const transport = items[0]?.transport;
			if (!transport) continue;
			const method = server.install_methods.find((candidate) =>
				marketMcpMethodMatchesTransport(candidate, transport),
			);
			if (!method) continue;
			locations.push({
				id: `${target.id}:${mergeKey}`,
				target,
				method,
				group: { mergeKey, transport, items },
			});
		}
	}

	return locations;
}

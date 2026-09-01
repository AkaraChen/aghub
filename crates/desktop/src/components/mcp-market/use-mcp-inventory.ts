import { useQueries } from "@tanstack/react-query";
import type { MarketMcpServer } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	buildMcpInventory,
	installedLocationsForServer,
} from "../../lib/mcp-market-inventory";
import type { Project } from "../../lib/store";
import { mcpListQueryOptions } from "../../requests/mcps";

export function useMcpInventory(projects: Project[]) {
	const api = useApi();
	const queries = useQueries({
		queries: [
			mcpListQueryOptions({ api, scope: "global" }),
			...projects.map((project) =>
				mcpListQueryOptions({
					api,
					scope: "project",
					projectRoot: project.path,
				}),
			),
		],
	});
	const inventory = buildMcpInventory(
		queries[0]?.data ?? [],
		projects,
		queries.slice(1).map((query) => query.data ?? []),
	);

	return {
		isPending: queries.some((query) => query.isPending),
		isError: queries.some((query) => query.isError),
		refetch: () => Promise.all(queries.map((query) => query.refetch())),
		locationsForServer: (server: MarketMcpServer) =>
			installedLocationsForServer(server, inventory),
	};
}

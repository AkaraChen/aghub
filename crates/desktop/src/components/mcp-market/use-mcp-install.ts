import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MarketMcpServer } from "../../generated/dto";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import { useInstallTarget } from "../../hooks/use-install-target";
import { supportsMcpScope } from "../../lib/agent-capabilities";
import { capture, captureException } from "../../lib/analytics";
import {
	buildPendingResults,
	type InstallResult,
} from "../../lib/install-utils";
import {
	buildMarketMcpRequest,
	initialMcpFieldValues,
	marketMcpIdentityKey,
	mcpTransportIdentityKey,
} from "../../lib/mcp-market-utils";
import {
	createMcpMutationOptions,
	mcpListQueryOptions,
} from "../../requests/mcps";

export function useMcpInstall() {
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const {
		projects,
		installToProject,
		setInstallToProject,
		selectedProjectId,
		selectedProject,
		canInstallToProject,
		setSelectedProjectId,
		resetInstallTarget,
	} = useInstallTarget();
	const createMutation = useMutation(
		createMcpMutationOptions({ api, queryClient }),
	);

	const [installModalOpen, setInstallModalOpen] = useState(false);
	const [selectedServer, setSelectedServer] =
		useState<MarketMcpServer | null>(null);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
		() => new Set(),
	);
	const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
	const [installResults, setInstallResults] = useState<InstallResult[]>([]);
	const [isInstalling, setIsInstalling] = useState(false);

	const scope = installToProject ? "project" : "global";
	const mcpAgents = availableAgents.filter(
		(agent) => agent.isUsable && supportsMcpScope(agent, scope),
	);

	// Installed MCPs across agents — the "lock" for catalog entries. After an
	// install the create mutation invalidates these queries, so it stays fresh.
	const { data: installedMcps = [] } = useQuery(
		mcpListQueryOptions({ api, scope: "global" }),
	);
	const installedKeys = new Set(
		installedMcps.map((mcp) => mcpTransportIdentityKey(mcp.transport)),
	);
	const installedAgentIds = selectedServer
		? new Set(
				installedMcps
					.filter(
						(mcp) =>
							mcp.agent != null &&
							mcpTransportIdentityKey(mcp.transport) ===
								marketMcpIdentityKey(selectedServer),
					)
					.map((mcp) => mcp.agent as string),
			)
		: new Set<string>();

	const handleInstallClick = (server: MarketMcpServer) => {
		setSelectedServer(server);
		setSelectedAgents(new Set());
		setFieldValues(initialMcpFieldValues(server));
		setInstallResults([]);
		resetInstallTarget();
		setInstallModalOpen(true);
	};

	const setFieldValue = (name: string, value: string) => {
		setFieldValues((prev) => ({ ...prev, [name]: value }));
	};

	const handleInstall = async () => {
		if (!selectedServer || selectedAgents.size === 0) return;
		if (installToProject && !selectedProjectId) return;

		setIsInstalling(true);
		const pending = buildPendingResults(selectedAgents, availableAgents);
		setInstallResults(pending);

		const body = buildMarketMcpRequest(selectedServer, fieldValues);
		const projectRoot = selectedProject?.path;

		const settled = await Promise.all(
			pending.map(async (result) => {
				try {
					await createMutation.mutateAsync({
						agent: result.agentId,
						scope,
						body,
						projectRoot,
					});
					return { ...result, status: "success" as const };
				} catch (err) {
					captureException(err);
					return {
						...result,
						status: "error" as const,
						error: err instanceof Error ? err.message : String(err),
					};
				}
			}),
		);

		setInstallResults(settled);
		if (settled.every((result) => result.status === "success")) {
			capture("mcp installed from market", {
				server: selectedServer.name,
				transport: selectedServer.transport,
				agents: Array.from(selectedAgents),
				scope,
			});
		}
		setIsInstalling(false);
	};

	const handleCloseInstallModal = () => {
		setInstallModalOpen(false);
		setSelectedServer(null);
		setSelectedAgents(new Set());
		setFieldValues({});
		setInstallResults([]);
		resetInstallTarget();
	};

	return {
		installModalOpen,
		selectedServer,
		selectedAgents,
		setSelectedAgents,
		fieldValues,
		setFieldValue,
		installResults,
		isInstalling,
		mcpAgents,
		installToProject,
		setInstallToProject,
		canInstallToProject,
		selectedProjectId,
		setSelectedProjectId,
		projects,
		installedKeys,
		installedAgentIds,
		handleInstallClick,
		handleInstall,
		handleCloseInstallModal,
	};
}

import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useReducer, useRef, useState } from "react";
import type { MarketMcpServer } from "../../generated/dto";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import { useInstallTarget } from "../../hooks/use-install-target";
import {
	supportsMcpScope,
	supportsMcpTransport,
} from "../../lib/agent-capabilities";
import { capture, captureException } from "../../lib/analytics";
import {
	buildPendingResults,
	type InstallResult,
} from "../../lib/install-utils";
import {
	buildMarketMcpRequest,
	initialMcpFieldValues,
	invalidMcpInputIds,
	marketMcpMatchesTransport,
} from "../../lib/mcp-market-utils";
import { getMcpMergeKey } from "../../lib/utils";
import {
	createMcpMutationOptions,
	mcpListQueryOptions,
} from "../../requests/mcps";
import type { McpGroup } from "../mcp-detail";

interface InstallDialogState {
	isOpen: boolean;
	server: MarketMcpServer | null;
	selectedAgents: Set<string>;
	fieldValues: Record<string, string>;
	results: InstallResult[];
	isInstalling: boolean;
}

type InstallDialogAction =
	| { type: "open"; server: MarketMcpServer }
	| { type: "select_agents"; agents: Set<string> }
	| { type: "set_field"; id: string; value: string }
	| { type: "start"; results: InstallResult[] }
	| { type: "finish"; results: InstallResult[] }
	| { type: "close" };

const CLOSED_INSTALL_DIALOG: InstallDialogState = {
	isOpen: false,
	server: null,
	selectedAgents: new Set(),
	fieldValues: {},
	results: [],
	isInstalling: false,
};

function installDialogReducer(
	state: InstallDialogState,
	action: InstallDialogAction,
): InstallDialogState {
	switch (action.type) {
		case "open":
			return {
				...CLOSED_INSTALL_DIALOG,
				isOpen: true,
				server: action.server,
				fieldValues: initialMcpFieldValues(action.server),
			};
		case "select_agents":
			return { ...state, selectedAgents: action.agents };
		case "set_field":
			return {
				...state,
				fieldValues: {
					...state.fieldValues,
					[action.id]: action.value,
				},
			};
		case "start":
			return { ...state, isInstalling: true, results: action.results };
		case "finish":
			return { ...state, isInstalling: false, results: action.results };
		case "close":
			return CLOSED_INSTALL_DIALOG;
	}
}

export function useMcpInstall() {
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const {
		projects,
		installToProject,
		setInstallToProject: updateInstallTarget,
		selectedProjectId,
		selectedProject,
		canInstallToProject,
		setSelectedProjectId,
		resetInstallTarget,
	} = useInstallTarget();
	const createMutation = useMutation(
		createMcpMutationOptions({ api, queryClient }),
	);
	const [dialog, dispatch] = useReducer(
		installDialogReducer,
		CLOSED_INSTALL_DIALOG,
	);
	const dialogSessionRef = useRef(0);
	const [manageGroup, setManageGroup] = useState<McpGroup | null>(null);
	const [isManageOpen, setIsManageOpen] = useState(false);

	const scope = installToProject ? "project" : "global";
	const selectedTransport = dialog.server
		? buildMarketMcpRequest(dialog.server, dialog.fieldValues).transport
		: undefined;
	const mcpAgents = availableAgents.filter(
		(agent) =>
			agent.isUsable &&
			supportsMcpScope(agent, scope) &&
			supportsMcpTransport(agent, selectedTransport),
	);
	const usableAgentIds = new Set(mcpAgents.map((agent) => agent.id));
	const selectedAgents = new Set(
		[...dialog.selectedAgents].filter((id) => usableAgentIds.has(id)),
	);

	const installedQueries = useQueries({
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
	const installedMcps = installedQueries.flatMap((query) => query.data ?? []);
	const installedForServer = (server: MarketMcpServer) =>
		installedMcps.filter((mcp) =>
			marketMcpMatchesTransport(server, mcp.transport),
		);

	const handleInstallClick = (server: MarketMcpServer) => {
		dialogSessionRef.current += 1;
		dispatch({ type: "open", server });
		resetInstallTarget();
	};

	const handleManageClick = (server: MarketMcpServer) => {
		const items = installedForServer(server);
		if (items.length === 0) return;
		setManageGroup({
			mergeKey: getMcpMergeKey(items[0].transport),
			transport: items[0].transport,
			items,
		});
		setIsManageOpen(true);
	};

	const handleInstall = async () => {
		const server = dialog.server;
		if (!server || selectedAgents.size === 0) return;
		if (installToProject && !selectedProjectId) return;
		if (invalidMcpInputIds(server, dialog.fieldValues).size > 0) return;

		const session = dialogSessionRef.current;
		const pending = buildPendingResults(selectedAgents, availableAgents);
		dispatch({ type: "start", results: pending });
		const body = buildMarketMcpRequest(server, dialog.fieldValues);
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
				} catch (error) {
					captureException(error);
					return {
						...result,
						status: "error" as const,
						error:
							error instanceof Error
								? error.message
								: String(error),
					};
				}
			}),
		);

		if (dialogSessionRef.current !== session) return;
		dispatch({ type: "finish", results: settled });
		if (settled.every((result) => result.status === "success")) {
			capture("mcp installed from market", {
				server: server.name,
				transport: server.transport.type,
				agents: Array.from(selectedAgents),
				scope,
			});
		}
	};

	const handleCloseInstallModal = () => {
		if (dialog.isInstalling) return;
		dialogSessionRef.current += 1;
		dispatch({ type: "close" });
		resetInstallTarget();
	};

	return {
		installModalOpen: dialog.isOpen,
		selectedServer: dialog.server,
		selectedAgents,
		setSelectedAgents: (agents: Set<string>) =>
			dispatch({ type: "select_agents", agents }),
		fieldValues: dialog.fieldValues,
		setFieldValue: (id: string, value: string) =>
			dispatch({ type: "set_field", id, value }),
		installResults: dialog.results,
		isInstalling: dialog.isInstalling,
		mcpAgents,
		installToProject,
		setInstallToProject: (value: boolean) => {
			updateInstallTarget(value);
			dispatch({ type: "select_agents", agents: new Set() });
		},
		canInstallToProject,
		selectedProjectId,
		setSelectedProjectId,
		projects,
		isInstalled: (server: MarketMcpServer) =>
			installedForServer(server).length > 0,
		manageGroup,
		isManageOpen,
		handleInstallClick,
		handleManageClick,
		handleCloseManage: () => setIsManageOpen(false),
		handleInstall,
		handleCloseInstallModal,
	};
}

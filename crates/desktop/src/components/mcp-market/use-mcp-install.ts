import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useReducer, useRef, useState } from "react";
import type {
	MarketMcpInstallMethod,
	MarketMcpServer,
} from "../../generated/dto";
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
	buildMcpInventory,
	installedLocationsForServer,
	type MarketMcpInstalledLocation,
} from "../../lib/mcp-market-inventory";
import {
	buildMarketMcpRequest,
	initialMcpFieldValues,
	invalidMcpInputIds,
} from "../../lib/mcp-market-utils";
import {
	createMcpMutationOptions,
	mcpListQueryOptions,
} from "../../requests/mcps";

interface InstallDialogState {
	isOpen: boolean;
	server: MarketMcpServer | null;
	methodId: string | null;
	selectedAgents: Set<string>;
	fieldValues: Record<string, string>;
	results: InstallResult[];
	isInstalling: boolean;
}

type InstallDialogAction =
	| { type: "open"; server: MarketMcpServer }
	| { type: "select_method"; method: MarketMcpInstallMethod }
	| { type: "select_agents"; agents: Set<string> }
	| { type: "set_field"; id: string; value: string }
	| { type: "start"; results: InstallResult[] }
	| { type: "finish"; results: InstallResult[] }
	| { type: "close" };

const CLOSED_INSTALL_DIALOG: InstallDialogState = {
	isOpen: false,
	server: null,
	methodId: null,
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
		case "open": {
			const method = action.server.install_methods[0] ?? null;
			return {
				...CLOSED_INSTALL_DIALOG,
				isOpen: true,
				server: action.server,
				methodId: method?.id ?? null,
				fieldValues: method ? initialMcpFieldValues(method) : {},
			};
		}
		case "select_method":
			return {
				...state,
				methodId: action.method.id,
				selectedAgents: new Set(),
				fieldValues: initialMcpFieldValues(action.method),
				results: [],
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
	const [manageLocation, setManageLocation] =
		useState<MarketMcpInstalledLocation | null>(null);
	const [manageLocations, setManageLocations] = useState<
		MarketMcpInstalledLocation[]
	>([]);
	const [isManageOpen, setIsManageOpen] = useState(false);
	const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);

	const scope = installToProject ? "project" : "global";
	const selectedMethod =
		dialog.server?.install_methods.find(
			(method) => method.id === dialog.methodId,
		) ?? null;
	const selectedTransport =
		dialog.server && selectedMethod
			? buildMarketMcpRequest(
					dialog.server,
					selectedMethod,
					dialog.fieldValues,
				).transport
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
	const isInventoryPending = installedQueries.some(
		(query) => query.isPending,
	);
	const isInventoryError = installedQueries.some((query) => query.isError);
	const inventory = buildMcpInventory(
		installedQueries[0]?.data ?? [],
		projects,
		installedQueries.slice(1).map((query) => query.data ?? []),
	);
	const locationsForServer = (server: MarketMcpServer) =>
		installedLocationsForServer(server, inventory);

	const handleInstallClick = (server: MarketMcpServer) => {
		dialogSessionRef.current += 1;
		dispatch({ type: "open", server });
		resetInstallTarget();
	};

	const openManageLocation = (location: MarketMcpInstalledLocation) => {
		setManageLocation(location);
		setIsLocationPickerOpen(false);
		setIsManageOpen(true);
	};

	const handleManageClick = (server: MarketMcpServer) => {
		const locations = locationsForServer(server);
		if (locations.length === 0) return;
		if (locations.length === 1 && locations[0]) {
			openManageLocation(locations[0]);
			return;
		}
		setManageLocations(locations);
		setIsLocationPickerOpen(true);
	};

	const handleInstall = async () => {
		const server = dialog.server;
		const method = selectedMethod;
		if (!server || !method || selectedAgents.size === 0) return;
		if (installToProject && !selectedProjectId) return;
		if (invalidMcpInputIds(method, dialog.fieldValues).size > 0) return;

		const session = dialogSessionRef.current;
		const pending = buildPendingResults(selectedAgents, availableAgents);
		dispatch({ type: "start", results: pending });
		const body = buildMarketMcpRequest(server, method, dialog.fieldValues);
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
				method: method.id,
				transport: method.transport.type,
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
		selectedMethod,
		setSelectedMethod: (method: MarketMcpInstallMethod) =>
			dispatch({ type: "select_method", method }),
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
		isInventoryPending,
		isInventoryError,
		refetchInventory: () =>
			Promise.all(installedQueries.map((query) => query.refetch())),
		isInstalled: (server: MarketMcpServer) =>
			locationsForServer(server).length > 0,
		manageGroup: manageLocation?.group ?? null,
		manageProjectPath: manageLocation?.target.projectRoot ?? undefined,
		manageLocations,
		isManageOpen,
		isLocationPickerOpen,
		handleInstallClick,
		handleManageClick,
		handleManageLocationSelect: openManageLocation,
		handleCloseLocationPicker: () => setIsLocationPickerOpen(false),
		handleCloseManage: () => {
			setIsManageOpen(false);
			setManageLocation(null);
		},
		handleInstall,
		handleCloseInstallModal,
	};
}

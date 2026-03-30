import { Button, Modal, toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AvailableAgent } from "../contexts/agent-availability";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type { McpResponse } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { cn } from "../lib/utils";
import { type AgentDiffLabel, AgentList, type AgentState } from "./agent-list";

type AgentCapabilityRequirement = keyof AvailableAgent["capabilities"] | "mcp";

const EMPTY_CAPABILITIES: AgentCapabilityRequirement[] = [];

interface ManageAgentsDialogProps {
	group: {
		mergeKey: string;
		transport: McpResponse["transport"];
		items: McpResponse[];
	};
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
	requiredCapabilities?: AgentCapabilityRequirement[];
}

export function ManageAgentsDialog({
	group,
	isOpen,
	onClose,
	projectPath,
	requiredCapabilities = EMPTY_CAPABILITIES,
}: ManageAgentsDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const supportsRequirements = useCallback(
		(agent: AvailableAgent) =>
			requiredCapabilities.every((capability) => {
				if (capability === "mcp") {
					return (
						agent.capabilities.mcp_stdio ||
						agent.capabilities.mcp_remote
					);
				}
				return Boolean(agent.capabilities[capability]);
			}),
		[requiredCapabilities],
	);

	const hasValidGroup = group?.items && Array.isArray(group.items);

	const installedAgentIds = useMemo(() => {
		if (!hasValidGroup) return new Set<string>();
		return new Set(group.items.map((item) => item.agent ?? "default"));
	}, [hasValidGroup, group]);

	const usableAgents = useMemo(
		() =>
			(availableAgents ?? []).filter(
				(a) => a?.isUsable && supportsRequirements(a),
			),
		[availableAgents, supportsRequirements],
	);

	const prevIsOpenRef = useRef(false);
	const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
	const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
		{},
	);
	const [isApplying, setIsApplying] = useState(false);

	if (isOpen && !prevIsOpenRef.current) {
		queueMicrotask(() => {
			setSelectedAgents(Array.from(installedAgentIds));
			setAgentStates({});
		});
	}
	prevIsOpenRef.current = isOpen;

	const selectedSet = useMemo(
		() => new Set(selectedAgents),
		[selectedAgents],
	);

	const getAgentDiffLabel = useCallback(
		(agentId: string): AgentDiffLabel | null => {
			const isCurrentAgent = installedAgentIds.has(agentId);
			const isSelected = selectedSet.has(agentId);

			if (isSelected && !isCurrentAgent) return "adding";
			if (!isSelected && isCurrentAgent) return "removing";
			if (isSelected && isCurrentAgent) return "installed";
			return "unconfigured";
		},
		[installedAgentIds, selectedSet],
	);

	const diffLabels = useMemo(() => {
		const labels: Record<string, AgentDiffLabel> = {};
		for (const agent of usableAgents) {
			const label = getAgentDiffLabel(agent.id);
			if (label) {
				labels[agent.id] = label;
			}
		}
		return labels;
	}, [usableAgents, getAgentDiffLabel]);

	const hasChanges = useMemo(() => {
		const toInstall = selectedAgents.filter(
			(id) => !installedAgentIds.has(id),
		);
		const toUninstall = Array.from(installedAgentIds).filter(
			(id) => !selectedSet.has(id),
		);
		return toInstall.length > 0 || toUninstall.length > 0;
	}, [selectedAgents, installedAgentIds, selectedSet]);

	const onCloseAndReset = () => {
		setAgentStates({});
		setIsApplying(false);
		onClose();
	};

	const handleSelectionChange = useCallback((keys: string[]) => {
		setSelectedAgents(keys);
	}, []);

	const handleApply = async () => {
		if (!hasValidGroup || group.items.length === 0) {
			toast.danger(t("invalidConfiguration"));
			return;
		}

		setIsApplying(true);
		const primary = group.items[0];

		if (!primary?.name || !primary.transport) {
			toast.danger(t("invalidMcpConfiguration"));
			setIsApplying(false);
			return;
		}

		const primaryAgent = primary.agent ?? "claude";
		const sourceAgentItem =
			group.items.find(
				(item) => (item.agent ?? "default") === primaryAgent,
			) ?? primary;

		const toInstall = selectedAgents.filter(
			(id) => !installedAgentIds.has(id),
		);
		const toUninstall = Array.from(installedAgentIds).filter(
			(id) => !selectedSet.has(id),
		);

		const pendingStates: Record<string, AgentState> = {};
		for (const id of [...toInstall, ...toUninstall]) {
			pendingStates[id] = { status: "pending" };
		}
		setAgentStates(pendingStates);

		try {
			const result = await api.mcps.reconcile({
				source: {
					agent: sourceAgentItem.agent ?? "claude",
					scope:
						sourceAgentItem.source === ConfigSource.Project
							? "project"
							: "global",
					project_root: projectPath,
					name: primary.name,
				},
				added: toInstall.length > 0 ? toInstall : undefined,
				removed: toUninstall.length > 0 ? toUninstall : undefined,
			});

			const newAgentStates: Record<string, AgentState> = {};
			for (const item of result.results) {
				newAgentStates[item.agent] = {
					status: item.success ? "success" : "error",
					error: item.error,
				};
			}
			setAgentStates(newAgentStates);

			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["mcps"] }),
				queryClient.invalidateQueries({ queryKey: ["project-mcps"] }),
			]);

			if (result.failed_count === 0) {
				toast.success(
					t("agentChangesApplied", { count: result.success_count }),
				);
				onCloseAndReset();
			} else {
				toast.danger(
					t("agentChangesFailed", {
						success: result.success_count,
						failed: result.failed_count,
					}),
				);
			}
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : t("unknownError");
			toast.danger(errorMessage);

			const errorStates: Record<string, AgentState> = {};
			for (const id of [...toInstall, ...toUninstall]) {
				errorStates[id] = { status: "error", error: errorMessage };
			}
			setAgentStates(errorStates);
		} finally {
			setIsApplying(false);
		}
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onCloseAndReset}>
			<Modal.Container>
				<Modal.Dialog className="w-[calc(100vw-2rem)] max-w-md sm:max-w-lg">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("manageAgents")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-4">
						{!hasValidGroup ? (
							<p className="text-sm text-muted">
								{t("invalidConfiguration")}
							</p>
						) : (
							<div
								className={cn(
									"transition-opacity",
									isApplying && "opacity-50",
								)}
							>
								<AgentList
									agents={usableAgents}
									selectedKeys={selectedAgents}
									onSelectionChange={handleSelectionChange}
									agentStates={agentStates}
									diffLabels={diffLabels}
									disabled={isApplying}
									label={t("selectAgentsForMcp")}
									emptyMessage={t("noTargetAgents")}
								/>
							</div>
						)}
					</Modal.Body>

					<Modal.Footer>
						<Button
							slot="close"
							variant="secondary"
							isDisabled={isApplying}
						>
							{t("cancel")}
						</Button>
						<Button
							onPress={handleApply}
							isDisabled={!hasChanges || isApplying}
						>
							{isApplying ? t("applying") : t("applyChanges")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

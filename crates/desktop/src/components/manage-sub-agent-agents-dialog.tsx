import { Button, Modal, toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SubAgentResponse } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { supportsSubAgentScope } from "../lib/agent-capabilities";
import { cn } from "../lib/utils";
import { reconcileSubAgentsMutationOptions } from "../requests/sub-agents";
import { type AgentDiffLabel, AgentList, type AgentState } from "./agent-list";

interface ManageSubAgentAgentsDialogProps {
	agent: SubAgentResponse;
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

export function ManageSubAgentAgentsDialog({
	agent,
	isOpen,
	onClose,
	projectPath,
}: ManageSubAgentAgentsDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const reconcileMutation = useMutation(
		reconcileSubAgentsMutationOptions({
			api,
			queryClient,
		}),
	);

	const scope = projectPath ? "project" : "global";

	const installedAgentIds = useMemo(() => {
		const ids = new Set<string>();
		if (agent.agent) ids.add(agent.agent);
		return ids;
	}, [agent.agent]);

	const usableAgents = useMemo(
		() =>
			(availableAgents ?? []).filter(
				(a) => a?.isUsable && supportsSubAgentScope(a, scope),
			),
		[availableAgents, scope],
	);

	const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
	const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
	const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
		{},
	);
	const [isApplying, setIsApplying] = useState(false);

	if (isOpen !== prevIsOpen) {
		setPrevIsOpen(isOpen);
		if (isOpen) {
			setSelectedAgents(Array.from(installedAgentIds));
			setAgentStates({});
			setIsApplying(false);
		}
	}

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
		for (const a of usableAgents) {
			const label = getAgentDiffLabel(a.id);
			if (label) labels[a.id] = label;
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
		if (!agent.agent) return;

		setIsApplying(true);

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
			const result = await reconcileMutation.mutateAsync({
				source: {
					agent: agent.agent,
					scope:
						agent.source === "project" ? "project" : "global",
					project_root: projectPath ?? null,
					name: agent.name,
				},
				added: toInstall.length > 0 ? toInstall : null,
				removed: toUninstall.length > 0 ? toUninstall : null,
			});

			const newAgentStates: Record<string, AgentState> = {};
			for (const item of result.results) {
				newAgentStates[item.agent] = {
					status: item.success ? "success" : "error",
					error: item.error ?? undefined,
				};
			}
			setAgentStates(newAgentStates);

			if (result.failed_count === 0) {
				toast.success(
					t("agentChangesApplied", {
						count: result.success_count,
					}),
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
								label={t("selectAgentsForSubAgent")}
								emptyMessage={t("noTargetAgents")}
							/>
						</div>
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

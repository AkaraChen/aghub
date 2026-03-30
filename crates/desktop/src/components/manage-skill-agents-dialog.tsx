import { Button, Modal, toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import { ConfigSource } from "../lib/api-types";
import {
	expandUniversalSelection,
	getSkillsPathGroups,
	type Scope,
} from "../lib/skills-path-group";
import { cn } from "../lib/utils";
import type { AgentDiffLabel, AgentState } from "./agent-list";
import type { SkillGroup } from "./skill-detail-helpers";
import { SkillsAgentList } from "./skills-agent-list";

interface ManageSkillAgentsDialogProps {
	group: SkillGroup;
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

export function ManageSkillAgentsDialog({
	group,
	isOpen,
	onClose,
	projectPath,
}: ManageSkillAgentsDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);
	const queryClient = useQueryClient();
	const { availableAgents, allAgents } = useAgentAvailability();

	const usableAgents = useMemo(
		() =>
			(availableAgents ?? []).filter(
				(a) => a?.isUsable && a.capabilities.skills,
			),
		[availableAgents],
	);

	const hasValidGroup = group?.items && Array.isArray(group.items);

	const scope: Scope = useMemo(() => {
		if (!hasValidGroup || group.items.length === 0) return "global";
		const primary = group.items[0];
		return primary?.source === ConfigSource.Project ? "project" : "global";
	}, [hasValidGroup, group]);

	const groups = useMemo(
		() => getSkillsPathGroups(allAgents ?? [], scope),
		[allAgents, scope],
	);

	const initialAgentIdsRef = useRef<Set<string>>(new Set());
	const prevIsOpenRef = useRef(false);
	const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
	const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
		{},
	);
	const [isApplying, setIsApplying] = useState(false);

	if (isOpen && !prevIsOpenRef.current) {
		const initial = group.items
			.map((item) => item.agent)
			.filter((agent): agent is string => agent != null);
		initialAgentIdsRef.current = new Set(initial);
		queueMicrotask(() => {
			setSelectedAgents(initial);
			setAgentStates({});
		});
	}
	prevIsOpenRef.current = isOpen;

	const currentAgentIds = initialAgentIdsRef.current;

	const selectedSet = useMemo(
		() => new Set(selectedAgents),
		[selectedAgents],
	);

	const getAgentDiffLabel = useCallback(
		(agentId: string): AgentDiffLabel | null => {
			const isCurrentAgent = currentAgentIds.has(agentId);
			const isSelected = selectedSet.has(agentId);

			if (isSelected && !isCurrentAgent) return "adding";
			if (!isSelected && isCurrentAgent) return "removing";
			if (isSelected && isCurrentAgent) return "installed";
			if (!isSelected && !isCurrentAgent) return "unconfigured";
			return null;
		},
		[currentAgentIds, selectedSet],
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
			(id) => !currentAgentIds.has(id),
		);
		const toUninstall = [...currentAgentIds].filter(
			(id) => !selectedSet.has(id),
		);
		return toInstall.length > 0 || toUninstall.length > 0;
	}, [selectedAgents, currentAgentIds, selectedSet]);

	const handleSelectionChange = useCallback((keys: string[]) => {
		setSelectedAgents(keys);
	}, []);

	const onCloseAndReset = () => {
		setAgentStates({});
		setIsApplying(false);
		onClose();
	};

	const handleApply = async () => {
		if (!hasValidGroup || group.items.length === 0) {
			toast.danger(t("invalidConfiguration"));
			return;
		}

		setIsApplying(true);
		const primary = group.items[0];

		if (!primary?.name) {
			toast.danger(t("invalidSkillConfiguration"));
			setIsApplying(false);
			return;
		}

		// Expand Universal selection to actual agents
		const expandedSelection = expandUniversalSelection(
			selectedAgents,
			groups,
		);
		const expandedSet = new Set(expandedSelection);

		const primaryAgent = primary.agent ?? "claude";
		const sourceAgentItem =
			group.items.find((item) => item.agent === primaryAgent) ?? primary;

		const toInstall = expandedSelection.filter(
			(id) => !currentAgentIds.has(id),
		);
		const toUninstall = [...currentAgentIds].filter(
			(id) => !expandedSet.has(id),
		);

		const pendingStates: Record<string, AgentState> = {};
		for (const id of [...toInstall, ...toUninstall]) {
			pendingStates[id] = { status: "pending" };
		}
		setAgentStates(pendingStates);

		try {
			const result = await api.skills.reconcile({
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
				queryClient.invalidateQueries({ queryKey: ["skills"] }),
				queryClient.invalidateQueries({ queryKey: ["project-skills"] }),
				queryClient.invalidateQueries({ queryKey: ["skill-locks"] }),
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

	const disabledAgents = useMemo(() => {
		const disabled = new Set<string>();
		for (const agent of usableAgents) {
			if (agent.availability && !agent.availability.is_available) {
				disabled.add(agent.id);
			}
		}
		return disabled;
	}, [usableAgents]);

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
								<SkillsAgentList
									agents={usableAgents}
									agentInfos={allAgents ?? []}
									selectedKeys={selectedAgents}
									onSelectionChange={handleSelectionChange}
									scope={scope}
									agentStates={agentStates}
									diffLabels={diffLabels}
									disabled={isApplying}
									disabledAgents={disabledAgents}
									label={t("selectAgentsForSkill")}
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

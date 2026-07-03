import { Button, Modal, toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { supportsSkillMutation } from "../lib/agent-capabilities";
import type { Scope } from "../lib/skills-path-group";
import { cn } from "../lib/utils";
import { reconcileSkillsMutationOptions } from "../requests/skills";
import type { AgentDiffLabel, AgentState } from "./agent-list";
import type { SkillGroup } from "./skill-detail-helpers";
import { SkillsAgentList } from "./skills-agent-list";

interface ManageSkillAgentsDialogProps {
	groups: SkillGroup[];
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

export function ManageSkillAgentsDialog({
	groups,
	isOpen,
	onClose,
	projectPath,
}: ManageSkillAgentsDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const reconcileMutation = useMutation(
		reconcileSkillsMutationOptions({
			api,
			queryClient,
		}),
	);

	const hasValidGroups =
		groups.length > 0 &&
		groups.every((group) => group?.items && Array.isArray(group.items));

	const installedAgentIdsByGroup = useMemo(
		() =>
			groups.map(
				(group) =>
					new Set(
						(group?.items ?? [])
							.map((item) => item.agent)
							.filter((agent): agent is string => agent != null),
					),
			),
		[groups],
	);

	const commonInstalledAgentIds = useMemo(() => {
		const [first, ...rest] = installedAgentIdsByGroup;
		if (!first) return new Set<string>();
		let common = Array.from(first);
		for (const installed of rest) {
			common = common.filter((id) => installed.has(id));
		}
		return new Set(common);
	}, [installedAgentIdsByGroup]);

	const scope: Scope = useMemo(() => {
		if (!hasValidGroups) return "global";
		const primary = groups[0]?.items[0];
		return primary?.source ?? "global";
	}, [hasValidGroups, groups]);

	const usableAgents = useMemo(
		() =>
			(availableAgents ?? []).filter(
				(a) => a?.isUsable && supportsSkillMutation(a, scope),
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
			setSelectedAgents(Array.from(commonInstalledAgentIds));
			setAgentStates({});
			setIsApplying(false);
		}
	}

	const selectedSet = useMemo(
		() => new Set(selectedAgents),
		[selectedAgents],
	);

	const diffLabels = useMemo((): Record<string, AgentDiffLabel> => {
		const labels: Record<string, AgentDiffLabel> = {};
		for (const agent of usableAgents) {
			const installedInAll = installedAgentIdsByGroup.every((installed) =>
				installed.has(agent.id),
			);
			const installedInAny = installedAgentIdsByGroup.some((installed) =>
				installed.has(agent.id),
			);
			const isSelected = selectedSet.has(agent.id);
			if (isSelected && !installedInAll) {
				labels[agent.id] = "adding";
			} else if (!isSelected && installedInAny) {
				labels[agent.id] = "removing";
			} else if (isSelected && installedInAll) {
				labels[agent.id] = "installed";
			} else {
				labels[agent.id] = "unconfigured";
			}
		}
		return labels;
	}, [usableAgents, installedAgentIdsByGroup, selectedSet]);

	const hasChanges = useMemo(
		() =>
			installedAgentIdsByGroup.some(
				(installed) =>
					selectedAgents.some((id) => !installed.has(id)) ||
					Array.from(installed).some((id) => !selectedSet.has(id)),
			),
		[installedAgentIdsByGroup, selectedAgents, selectedSet],
	);

	const handleSelectionChange = useCallback((keys: string[]) => {
		setSelectedAgents(keys);
	}, []);

	const onCloseAndReset = () => {
		setAgentStates({});
		setIsApplying(false);
		onClose();
	};

	const handleApply = async () => {
		if (!hasValidGroups) {
			toast.danger(t("invalidConfiguration"));
			return;
		}

		if (groups.some((group) => !group.items[0]?.name)) {
			toast.danger(t("invalidSkillConfiguration"));
			return;
		}

		setIsApplying(true);

		const plans = groups.map((group, index) => {
			const installed =
				installedAgentIdsByGroup[index] ?? new Set<string>();
			return {
				group,
				added: selectedAgents.filter((id) => !installed.has(id)),
				removed: Array.from(installed).filter(
					(id) => !selectedSet.has(id),
				),
			};
		});

		const changedIds = new Set<string>();
		for (const plan of plans) {
			for (const id of [...plan.added, ...plan.removed]) {
				changedIds.add(id);
			}
		}

		const pendingStates: Record<string, AgentState> = {};
		for (const id of changedIds) {
			pendingStates[id] = { status: "pending" };
		}
		setAgentStates(pendingStates);

		try {
			let successCount = 0;
			let failedCount = 0;
			const newAgentStates: Record<string, AgentState> = {};
			for (const plan of plans) {
				if (plan.added.length === 0 && plan.removed.length === 0) {
					continue;
				}

				const primary = plan.group.items[0];
				if (!primary?.name) continue;

				const primaryAgent = primary.agent ?? "claude";
				const sourceAgentItem =
					plan.group.items.find(
						(item) => item.agent === primaryAgent,
					) ?? primary;

				const result = await reconcileMutation.mutateAsync({
					source: {
						agent: sourceAgentItem.agent ?? "claude",
						scope:
							sourceAgentItem.source === "project"
								? "project"
								: "global",
						project_root: projectPath ?? null,
						name: primary.name,
					},
					added: plan.added.length > 0 ? plan.added : null,
					removed: plan.removed.length > 0 ? plan.removed : null,
				});

				for (const item of result.results) {
					if (item.success) {
						newAgentStates[item.agent] ??= { status: "success" };
					} else {
						newAgentStates[item.agent] = {
							status: "error",
							error: item.error ?? undefined,
						};
					}
				}
				successCount += result.success_count;
				failedCount += result.failed_count;
			}
			setAgentStates(newAgentStates);

			if (failedCount === 0) {
				toast.success(
					t("agentChangesApplied", { count: successCount }),
				);
				onCloseAndReset();
			} else {
				toast.danger(
					t("agentChangesFailed", {
						success: successCount,
						failed: failedCount,
					}),
				);
			}
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : t("unknownError");
			toast.danger(errorMessage);

			const errorStates: Record<string, AgentState> = {};
			for (const id of changedIds) {
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
						{!hasValidGroups ? (
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

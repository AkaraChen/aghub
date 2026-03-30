import { Button, Modal, toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import { ConfigSource } from "../lib/api-types";
import type { Scope } from "../lib/skills-path-group";
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
	const { availableAgents } = useAgentAvailability();

	const hasValidGroup = group?.items && Array.isArray(group.items);

	const installedAgentIds = useMemo(() => {
		if (!hasValidGroup) return new Set<string>();
		return new Set(
			group.items
				.map((item) => item.agent)
				.filter((agent): agent is string => agent != null),
		);
	}, [hasValidGroup, group]);

	const usableAgents = useMemo(
		() =>
			(availableAgents ?? [])
				.filter((a) => a?.isUsable && a.capabilities.skills)
				.filter((a) => !installedAgentIds.has(a.id)),
		[availableAgents, installedAgentIds],
	);

	const scope: Scope = useMemo(() => {
		if (!hasValidGroup || group.items.length === 0) return "global";
		const primary = group.items[0];
		return primary?.source === ConfigSource.Project ? "project" : "global";
	}, [hasValidGroup, group]);

	const prevIsOpenRef = useRef(false);
	const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
	const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
		{},
	);
	const [isApplying, setIsApplying] = useState(false);

	if (isOpen && !prevIsOpenRef.current) {
		queueMicrotask(() => {
			setSelectedAgents([]);
			setAgentStates({});
		});
	}
	prevIsOpenRef.current = isOpen;

	const selectedSet = useMemo(
		() => new Set(selectedAgents),
		[selectedAgents],
	);

	const diffLabels = useMemo((): Record<string, AgentDiffLabel> => {
		const labels: Record<string, AgentDiffLabel> = {};
		for (const agent of usableAgents) {
			if (selectedSet.has(agent.id)) {
				labels[agent.id] = "adding";
			}
		}
		return labels;
	}, [usableAgents, selectedSet]);

	const hasChanges = selectedAgents.length > 0;

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

		const primaryAgent = primary.agent ?? "claude";
		const sourceAgentItem =
			group.items.find((item) => item.agent === primaryAgent) ?? primary;

		const toInstall = selectedAgents;

		const pendingStates: Record<string, AgentState> = {};
		for (const id of toInstall) {
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
			for (const id of toInstall) {
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

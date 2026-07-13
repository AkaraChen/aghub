import { Button, Modal, toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AvailableAgent } from "../contexts/agent-availability";
import type { McpResponse } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { supportsMcp, supportsMcpScope } from "../lib/agent-capabilities";
import { cn } from "../lib/utils";
import { reconcileMcpsMutationOptions } from "../requests/mcps";
import { type AgentDiffLabel, AgentList, type AgentState } from "./agent-list";

type AgentCapabilityRequirement = keyof AvailableAgent["capabilities"] | "mcp";

const EMPTY_CAPABILITIES: AgentCapabilityRequirement[] = [];

interface ManageAgentsDialogProps {
	groups: {
		mergeKey: string;
		transport: McpResponse["transport"];
		items: McpResponse[];
	}[];
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
	requiredCapabilities?: AgentCapabilityRequirement[];
}

export function ManageAgentsDialog({
	groups,
	isOpen,
	onClose,
	projectPath,
	requiredCapabilities = EMPTY_CAPABILITIES,
}: ManageAgentsDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const reconcileMutation = useMutation(
		reconcileMcpsMutationOptions({
			api,
			queryClient,
		}),
	);

	const supportsRequirements = useCallback(
		(agent: AvailableAgent) =>
			requiredCapabilities.every((capability) => {
				if (capability === "mcp") {
					return supportsMcp(agent);
				}
				return Boolean(agent.capabilities[capability]);
			}),
		[requiredCapabilities],
	);

	const hasValidGroups =
		groups.length > 0 &&
		groups.every((group) => group?.items && Array.isArray(group.items));

	const installedAgentIdsByGroup = useMemo(
		() =>
			groups.map(
				(group) =>
					new Set(
						(group?.items ?? []).map(
							(item) => item.agent ?? "default",
						),
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

	// Agents installed on a strict subset of the selected items. With a
	// single item this is always empty, so single-item behavior is
	// unchanged.
	const partiallyInstalledAgentIds = useMemo(() => {
		const partial = new Set<string>();
		for (const installed of installedAgentIdsByGroup) {
			for (const id of installed) {
				if (!commonInstalledAgentIds.has(id)) {
					partial.add(id);
				}
			}
		}
		return partial;
	}, [installedAgentIdsByGroup, commonInstalledAgentIds]);

	const usableAgents = useMemo(
		() =>
			(availableAgents ?? []).filter(
				(a) =>
					a?.isUsable &&
					supportsRequirements(a) &&
					supportsMcpScope(a, projectPath ? "project" : "global"),
			),
		[availableAgents, projectPath, supportsRequirements],
	);

	const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
	const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
	// macOS-style tri-state: agents installed on only some items start
	// indeterminate; while an agent stays in this set it is left untouched
	// by Apply.
	const [indeterminateAgents, setIndeterminateAgents] = useState<Set<string>>(
		() => new Set(),
	);
	const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
		{},
	);
	const [isApplying, setIsApplying] = useState(false);

	if (isOpen !== prevIsOpen) {
		setPrevIsOpen(isOpen);
		if (isOpen) {
			setSelectedAgents(Array.from(commonInstalledAgentIds));
			setIndeterminateAgents(new Set(partiallyInstalledAgentIds));
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
			// Still in its initial indeterminate state: Apply leaves every
			// item untouched for this agent.
			if (indeterminateAgents.has(agentId)) return "partial";

			const installedInAll = installedAgentIdsByGroup.every((installed) =>
				installed.has(agentId),
			);
			const installedInAny = installedAgentIdsByGroup.some((installed) =>
				installed.has(agentId),
			);
			const isSelected = selectedSet.has(agentId);

			if (isSelected && !installedInAll) return "adding";
			if (!isSelected && installedInAny) return "removing";
			if (isSelected && installedInAll) return "installed";
			return "unconfigured";
		},
		[indeterminateAgents, installedAgentIdsByGroup, selectedSet],
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

	// True only when some agent's state differs from its initial one:
	// agents left indeterminate cause no change and never count.
	const hasChanges = useMemo(
		() =>
			installedAgentIdsByGroup.some(
				(installed) =>
					selectedAgents.some((id) => !installed.has(id)) ||
					Array.from(installed).some(
						(id) =>
							!selectedSet.has(id) &&
							!indeterminateAgents.has(id),
					),
			),
		[
			installedAgentIdsByGroup,
			selectedAgents,
			selectedSet,
			indeterminateAgents,
		],
	);

	const onCloseAndReset = () => {
		setAgentStates({});
		setIsApplying(false);
		onClose();
	};

	const handleSelectionChange = useCallback((keys: string[]) => {
		setSelectedAgents(keys);
		// Clicking an indeterminate agent selects it; from then on it
		// cycles checked/unchecked like the rest.
		setIndeterminateAgents((prev) => {
			if (prev.size === 0) return prev;
			const next = new Set(
				Array.from(prev).filter((id) => !keys.includes(id)),
			);
			return next.size === prev.size ? prev : next;
		});
	}, []);

	const handleApply = async () => {
		if (!hasValidGroups) {
			toast.danger(t("invalidConfiguration"));
			return;
		}

		if (
			groups.some(
				(group) => !group.items[0]?.name || !group.items[0].transport,
			)
		) {
			toast.danger(t("invalidMcpConfiguration"));
			return;
		}

		setIsApplying(true);

		const plans = groups.map((group, index) => {
			const installed =
				installedAgentIdsByGroup[index] ?? new Set<string>();
			return {
				group,
				added: selectedAgents.filter((id) => !installed.has(id)),
				// Agents still in their initial indeterminate state are
				// left untouched — never uninstall what the user did not
				// explicitly uncheck.
				removed: Array.from(installed).filter(
					(id) =>
						!selectedSet.has(id) && !indeterminateAgents.has(id),
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
						(item) => (item.agent ?? "default") === primaryAgent,
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
								<AgentList
									agents={usableAgents}
									selectedKeys={selectedAgents}
									indeterminateKeys={indeterminateAgents}
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

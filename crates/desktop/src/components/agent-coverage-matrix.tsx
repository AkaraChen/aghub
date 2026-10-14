import { QuestionMarkCircleIcon } from "@heroicons/react/24/solid";
import { AlertDialog, Button, Spinner, toast, Tooltip } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import type { ResourceKind } from "../hooks/use-resource-actions";
import {
	supportsMcpScope,
	supportsIndividualSkillTarget,
} from "../lib/agent-capabilities";
import { AgentIcon } from "../lib/agent-icons";
import { UNIVERSAL_SKILL_TARGET_ID } from "../lib/skill-targets";
import { cn } from "../lib/utils";
import { reconcileMcpsMutationOptions } from "../requests/mcps";
import { reconcileSkillsMutationOptions } from "../requests/skills";
import { UniversalSkillTargetIcon } from "./universal-skill-target-icon";

export interface MatrixGroup {
	key: string;
	/** Resource name the reconcile source refers to */
	name: string;
	/** Agent owning the source copy */
	sourceAgent: string;
	sourceScope: "global" | "project";
	/** Agents this resource is currently installed on */
	installedAgents: string[];
}

/** Builds one matrix row for the global-scope settings pages. */
export function matrixGroup(
	key: string,
	name: string,
	sourceAgent: string | null | undefined,
	installedAgents: (string | null)[],
): MatrixGroup {
	return {
		key,
		name,
		sourceAgent: sourceAgent ?? "claude",
		sourceScope: "global",
		installedAgents: installedAgents.filter(
			(agent): agent is string => agent != null,
		),
	};
}

interface AgentCoverageMatrixProps {
	kind: ResourceKind;
	groups: MatrixGroup[];
	/** Opens the explicit tri-state manager for the current selection. */
	onManage?: () => void;
}

/**
 * Per-agent coverage of the current selection. The bulk panel uses this as
 * a summary and routes edits through the explicit tri-state manager; the
 * source detail panel keeps the compact direct-editing behavior.
 */
export function AgentCoverageMatrix({
	kind,
	groups,
	onManage,
}: AgentCoverageMatrixProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const skillReconcile = useMutation(
		reconcileSkillsMutationOptions({ api, queryClient }),
	);
	const mcpReconcile = useMutation(
		reconcileMcpsMutationOptions({ api, queryClient }),
	);
	const reconcile = kind === "skill" ? skillReconcile : mcpReconcile;

	const scope = groups[0]?.sourceScope ?? "global";
	const rows = useMemo(() => {
		const agents = availableAgents
			.filter(
				(agent) =>
					agent.isConfigurable &&
					(kind === "skill"
						? supportsIndividualSkillTarget(agent, scope)
						: supportsMcpScope(agent, scope)),
			)
			.map((agent) => ({
				id: agent.id,
				displayName: agent.display_name,
				universal: false,
			}));
		if (kind !== "skill") return agents;
		return [
			{
				id: UNIVERSAL_SKILL_TARGET_ID,
				displayName: t("universalAgentTarget"),
				universal: true,
			},
			...agents,
		];
	}, [availableAgents, kind, scope, t]);

	const [pendingAgent, setPendingAgent] = useState<string | null>(null);
	const [confirmAgent, setConfirmAgent] = useState<{
		id: string;
		name: string;
	} | null>(null);

	const installedCount = (agentId: string) =>
		groups.filter((g) => g.installedAgents.includes(agentId)).length;

	const run = async (
		agentId: string,
		agentName: string,
		mode: "install" | "uninstall",
	) => {
		const targets = groups.filter((g) =>
			mode === "install"
				? !g.installedAgents.includes(agentId)
				: g.installedAgents.includes(agentId),
		);
		if (targets.length === 0) return;

		setPendingAgent(agentId);
		let succeeded = 0;
		let failed = 0;
		const failedItems: string[] = [];
		for (const group of targets) {
			try {
				const result = await reconcile.mutateAsync({
					source: {
						agent: group.sourceAgent,
						scope: group.sourceScope,
						project_root: null,
						name: group.name,
					},
					added: mode === "install" ? [agentId] : null,
					removed: mode === "uninstall" ? [agentId] : null,
				});
				succeeded += result.success_count;
				failed += result.failed_count;
				const operationFailures = result.results.filter(
					(operation) => !operation.success,
				);
				if (operationFailures.length > 0) {
					failedItems.push(
						...operationFailures.map((operation) =>
							operation.error
								? `${group.name} — ${operation.error}`
								: group.name,
						),
					);
				} else if (result.failed_count > 0) {
					failedItems.push(group.name);
				}
			} catch (error) {
				failed += 1;
				failedItems.push(
					error instanceof Error
						? `${group.name} — ${error.message}`
						: group.name,
				);
			}
		}
		setPendingAgent(null);
		const message = t("agentBatchResult", {
			success: succeeded,
			failed,
		});
		if (failed > 0) {
			toast.danger(message, {
				description: t("agentBatchFailures", {
					agent: agentName,
					items: failedItems.join("; "),
				}),
			});
		} else {
			toast.success(message);
		}
	};

	if (groups.length === 0 || rows.length === 0) return null;

	return (
		<div className="space-y-2 border-t border-separator pt-4">
			<div className="space-y-1 px-1">
				<div className="flex items-center gap-1">
					<p className="text-xs font-medium text-muted">
						{t("agentCoverage")}
					</p>
					<Tooltip delay={0}>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="size-5 min-h-5 min-w-5 text-muted"
							aria-label={t("agentCoverageHelp")}
						>
							<QuestionMarkCircleIcon className="size-3.5" />
						</Button>
						<Tooltip.Content>
							{t(onManage ? "matrixSummaryHint" : "matrixHint")}
						</Tooltip.Content>
					</Tooltip>
				</div>
				<p className="text-xs text-muted">
					{t(onManage ? "matrixSummaryHint" : "matrixHint")}
				</p>
			</div>
			<ul className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
				{rows.map((target) => {
					const installed = installedCount(target.id);
					const total = groups.length;
					const full = installed === total;
					const none = installed === 0;
					const isPending = pendingAgent === target.id;
					return (
						<li key={target.id}>
							<button
								type="button"
								data-testid={`matrix-row-${target.id}`}
								disabled={pendingAgent !== null}
								aria-label={
									onManage
										? t("agentCoverageRow", {
												agent: target.displayName,
												installed,
												total,
											})
										: undefined
								}
								onClick={() => {
									if (onManage) {
										onManage();
									} else if (full) {
										setConfirmAgent({
											id: target.id,
											name: target.displayName,
										});
									} else {
										void run(
											target.id,
											target.displayName,
											"install",
										);
									}
								}}
								className={cn(
									"group flex w-full items-center gap-1.5 rounded-lg bg-surface px-2 py-1.5 text-left text-sm ring-1 ring-border transition-colors duration-[var(--dur-fast)] disabled:opacity-60",
									full
										? "bg-accent/10 ring-accent/30 hover:bg-danger/10 hover:ring-danger/30"
										: "hover:bg-accent/10 hover:ring-accent/30",
								)}
							>
								{target.universal ? (
									<UniversalSkillTargetIcon size="xs" />
								) : (
									<AgentIcon
										id={target.id}
										name={target.displayName}
										size="xs"
										variant="ghost"
									/>
								)}
								<span
									className={cn(
										"min-w-0 flex-1 truncate",
										none && "text-muted",
									)}
								>
									{target.displayName}
								</span>
								{isPending ? (
									<Spinner size="sm" color="current" />
								) : (
									<span
										className={cn(
											"shrink-0 text-[10px] font-medium tabular-nums",
											full
												? "text-accent group-hover:text-danger"
												: "text-muted",
										)}
									>
										{installed}/{total}
									</span>
								)}
							</button>
						</li>
					);
				})}
			</ul>

			<AlertDialog.Backdrop
				isOpen={confirmAgent !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmAgent(null);
				}}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("uninstallFromAgent")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							<p className="text-sm text-muted">
								{t("uninstallFromAgentConfirm", {
									agent: confirmAgent?.name ?? "",
									count: groups.length,
								})}
							</p>
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button slot="close" variant="tertiary">
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								onPress={() => {
									if (confirmAgent) {
										void run(
											confirmAgent.id,
											confirmAgent.name,
											"uninstall",
										);
										setConfirmAgent(null);
									}
								}}
							>
								{t("uninstall")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</div>
	);
}

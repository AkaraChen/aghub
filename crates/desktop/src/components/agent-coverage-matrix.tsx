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
	supportsSkillMutation,
} from "../lib/agent-capabilities";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";
import { reconcileMcpsMutationOptions } from "../requests/mcps";
import { reconcileSkillsMutationOptions } from "../requests/skills";

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

interface AgentCoverageMatrixProps {
	kind: ResourceKind;
	groups: MatrixGroup[];
	projectPath?: string;
}

/**
 * Per-agent coverage of the current selection, editable in place: a
 * none/partial row installs the missing items on click; a fully covered
 * row asks for confirmation, then uninstalls everywhere. One agent
 * mutates at a time; failures surface as a summary toast and the matrix
 * re-renders from the refetched list.
 */
export function AgentCoverageMatrix({
	kind,
	groups,
	projectPath,
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
	const rows = useMemo(
		() =>
			availableAgents.filter(
				(agent) =>
					agent.isUsable &&
					(kind === "skill"
						? supportsSkillMutation(agent, scope)
						: supportsMcpScope(agent, scope)),
			),
		[availableAgents, kind, scope],
	);

	const [pendingAgent, setPendingAgent] = useState<string | null>(null);
	const [confirmAgent, setConfirmAgent] = useState<{
		id: string;
		name: string;
	} | null>(null);

	const installedCount = (agentId: string) =>
		groups.filter((g) => g.installedAgents.includes(agentId)).length;

	const run = async (agentId: string, mode: "install" | "uninstall") => {
		const targets = groups.filter((g) =>
			mode === "install"
				? !g.installedAgents.includes(agentId)
				: g.installedAgents.includes(agentId),
		);
		if (targets.length === 0) return;

		setPendingAgent(agentId);
		let failed = 0;
		for (const group of targets) {
			try {
				await reconcile.mutateAsync({
					source: {
						agent: group.sourceAgent,
						scope: group.sourceScope,
						project_root: projectPath ?? null,
						name: group.name,
					},
					added: mode === "install" ? [agentId] : null,
					removed: mode === "uninstall" ? [agentId] : null,
				});
			} catch {
				failed += 1;
			}
		}
		setPendingAgent(null);
		if (failed > 0) {
			toast.danger(
				t("agentBatchResult", {
					success: targets.length - failed,
					failed,
				}),
			);
		}
	};

	if (groups.length === 0 || rows.length === 0) return null;

	return (
		<div className="space-y-2 border-t border-separator pt-4">
			<div className="flex items-center gap-1 px-1">
				<p className="text-xs font-medium text-muted">
					{t("agentCoverage")}
				</p>
				<Tooltip delay={0}>
					<Tooltip.Trigger>
						<span className="flex items-center text-muted">
							<QuestionMarkCircleIcon className="size-3.5" />
						</span>
					</Tooltip.Trigger>
					<Tooltip.Content>{t("matrixHint")}</Tooltip.Content>
				</Tooltip>
			</div>
			<ul className="grid grid-cols-3 gap-1">
				{rows.map((agent) => {
					const installed = installedCount(agent.id);
					const total = groups.length;
					const full = installed === total;
					const none = installed === 0;
					const isPending = pendingAgent === agent.id;
					return (
						<li key={agent.id}>
							<button
								type="button"
								data-testid={`matrix-row-${agent.id}`}
								disabled={pendingAgent !== null}
								onClick={() => {
									if (full) {
										setConfirmAgent({
											id: agent.id,
											name: agent.display_name,
										});
									} else {
										void run(agent.id, "install");
									}
								}}
								className={cn(
									"flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm ring-1 ring-transparent transition-colors duration-[var(--dur-fast)] hover:bg-default disabled:opacity-60",
									// Fill encodes coverage at a glance
									full && "bg-accent/10 ring-accent/30",
								)}
							>
								<AgentIcon
									id={agent.id}
									name={agent.display_name}
									size="xs"
									variant="ghost"
								/>
								<span
									className={cn(
										"min-w-0 flex-1 truncate",
										none && "text-muted",
									)}
								>
									{agent.display_name}
								</span>
								{isPending ? (
									<Spinner size="sm" color="current" />
								) : (
									<span
										className={cn(
											"shrink-0 text-[10px] font-medium tabular-nums",
											full ? "text-accent" : "text-muted",
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
										void run(confirmAgent.id, "uninstall");
										setConfirmAgent(null);
									}
								}}
							>
								{t("delete")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</div>
	);
}

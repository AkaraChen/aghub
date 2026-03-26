import {
	ArrowPathIcon,
	CheckCircleIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Checkbox,
	CheckboxGroup,
	Description,
	Label,
	Modal,
	toast,
} from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { AgentIcon } from "../lib/agent-icons";
import { createApi } from "../lib/api";
import type { McpResponse } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { cn } from "../lib/utils";

interface ManageAgentsDialogProps {
	group: {
		mergeKey: string;
		transport: McpResponse["transport"];
		items: McpResponse[];
	};
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

type AgentStatus = "idle" | "pending" | "success" | "error";

interface AgentState {
	status: AgentStatus;
	error?: string;
}

export function ManageAgentsDialog({
	group,
	isOpen,
	onClose,
	projectPath,
}: ManageAgentsDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	// Safely handle undefined/null data
	const usableAgents = useMemo(
		() => (availableAgents ?? []).filter((a) => a?.isUsable),
		[availableAgents],
	);

	// Validate group data
	const hasValidGroup = group?.items && Array.isArray(group.items);

	const initialAgentIdsRef = useRef<Set<string>>(new Set());
	const prevIsOpenRef = useRef(false);
	const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
	const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
		{},
	);
	const [isApplying, setIsApplying] = useState(false);

	// Sync initial state when dialog opens/closes — no setState during render
	if (isOpen && !prevIsOpenRef.current) {
		const initial = group.items.map((item) => item.agent ?? "default");
		initialAgentIdsRef.current = new Set(initial);
		// Use the ref to set initial values; React will batch these with the
		// open transition since this runs during the commit triggered by isOpen changing
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
	const toInstall = useMemo(
		() => selectedAgents.filter((id) => !currentAgentIds.has(id)),
		[selectedAgents, currentAgentIds],
	);
	const toUninstall = useMemo(
		() => [...currentAgentIds].filter((id) => !selectedSet.has(id)),
		[currentAgentIds, selectedSet],
	);
	const hasChanges = toInstall.length > 0 || toUninstall.length > 0;

	const getAgentDiffLabel = useCallback(
		(agentId: string) => {
			const isCurrentAgent = currentAgentIds.has(agentId);
			const isSelected = selectedSet.has(agentId);

			if (isSelected && !isCurrentAgent) return "adding";
			if (!isSelected && isCurrentAgent) return "removing";
			if (isSelected && isCurrentAgent) return "installed";
			return null;
		},
		[currentAgentIds, selectedSet],
	);

	const handleSelectionChange = useCallback((values: (string | number)[]) => {
		setSelectedAgents(values as string[]);
	}, []);

	const onCloseAndReset = () => {
		setAgentStates({});
		setIsApplying(false);
		onClose();
	};

	const handleApply = async () => {
		// Guard against missing data
		if (!hasValidGroup || group.items.length === 0) {
			toast.danger(t("invalidConfiguration"));
			return;
		}

		setIsApplying(true);
		const primary = group.items[0];

		// Validate primary item
		if (!primary?.name || !primary.transport) {
			toast.danger(t("invalidMcpConfiguration"));
			setIsApplying(false);
			return;
		}

		// Mark all changing agents as pending
		const pendingStates: Record<string, AgentState> = {};
		for (const id of [...toInstall, ...toUninstall]) {
			pendingStates[id] = { status: "pending" };
		}
		setAgentStates(pendingStates);

		let successCount = 0;
		let errorCount = 0;

		const operations = [
			...toInstall.map((id) => ({ id, action: "install" as const })),
			...toUninstall.map((id) => ({
				id,
				action: "uninstall" as const,
			})),
		];

		// Execute all operations and collect results
		const results = await Promise.all(
			operations.map(async ({ id, action }) => {
				try {
					if (action === "install") {
						const scope = projectPath ? "project" : "global";
						await api.mcps.create(
							id,
							scope,
							{
								name: primary.name,
								transport: primary.transport,
								timeout: primary.timeout,
							},
							projectPath,
						);
					} else {
						const scope =
							group.items.find(
								(i) => (i.agent ?? "default") === id,
							)?.source === ConfigSource.Project
								? "project"
								: "global";
						await api.mcps.delete(
							primary.name,
							id,
							scope,
							projectPath,
						);
					}
					return { id, status: "success" as const, error: undefined };
				} catch (err) {
					return {
						id,
						status: "error" as const,
						error: err instanceof Error ? err.message : String(err),
					};
				}
			}),
		);

		// Count successes and errors
		results.forEach((result) => {
			if (result.status === "success") {
				successCount++;
			} else {
				errorCount++;
			}
		});

		// Batch update all agent states at once
		const newAgentStates = Object.fromEntries(
			results.map((r) => [r.id, { status: r.status, error: r.error }]),
		);
		setAgentStates(newAgentStates);

		// Wait for query cache to refresh so the detail panel updates
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["mcps"] }),
			queryClient.invalidateQueries({ queryKey: ["project-mcps"] }),
		]);
		setIsApplying(false);

		// Show toast with results
		if (errorCount === 0) {
			toast.success(
				t("agentChangesApplied", {
					count: successCount,
				}),
			);
			// Auto-close on full success — data is already refreshed
			onCloseAndReset();
		} else {
			toast.danger(
				t("agentChangesFailed", {
					success: successCount,
					failed: errorCount,
				}),
			);
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

					<Modal.Body>
						{!hasValidGroup ? (
							<p className="text-sm text-muted">
								{t("invalidConfiguration")}
							</p>
						) : usableAgents.length === 0 ? (
							<p className="text-sm text-muted">
								{t("noTargetAgents")}
							</p>
						) : (
							<div
								className={cn(
									"transition-opacity",
									isApplying && "opacity-50",
								)}
							>
								<CheckboxGroup
									value={selectedAgents}
									onChange={handleSelectionChange}
									isDisabled={isApplying}
								>
									<Label className="sr-only">
										{t("selectAgentsForMcp")}
									</Label>
									<div className="flex flex-col gap-2">
										{usableAgents.map((agent) => {
											const diffLabel = getAgentDiffLabel(
												agent.id,
											);
											const state = agentStates[agent.id];

											return (
												<Checkbox
													key={agent.id}
													value={agent.id}
													variant="secondary"
													className={cn(
														"group relative flex w-full flex-col gap-4 rounded-3xl bg-surface px-5 py-4 transition-all",
														"data-[selected=true]:bg-accent/10",
													)}
												>
													<Checkbox.Control className="absolute top-3 right-4 size-5 rounded-full before:rounded-full">
														<Checkbox.Indicator />
													</Checkbox.Control>
													<Checkbox.Content className="flex flex-row items-start justify-start gap-4">
														<AgentIcon
															id={agent.id}
															name={
																agent.display_name
															}
															size="sm"
															variant="ghost"
														/>
														<div className="flex flex-1 flex-col gap-1">
															<Label className="truncate">
																{
																	agent.display_name
																}
															</Label>
															{/* Status indicator during apply */}
															{state?.status ===
																"pending" && (
																<span
																	aria-live="polite"
																	className="flex items-center gap-1"
																>
																	<ArrowPathIcon
																		className="size-3.5 animate-spin text-muted"
																		aria-label={t(
																			"processing",
																		)}
																	/>
																	<span className="sr-only">
																		{t(
																			"processing",
																		)}
																	</span>
																</span>
															)}
															{state?.status ===
																"success" && (
																<span
																	aria-live="polite"
																	className="flex items-center gap-1"
																>
																	<CheckCircleIcon
																		className="size-3.5 text-success"
																		aria-label={t(
																			"success",
																		)}
																	/>
																	<span className="sr-only">
																		{t(
																			"success",
																		)}
																	</span>
																</span>
															)}
															{state?.status ===
																"error" && (
																<span
																	aria-live="assertive"
																	className="flex items-center gap-1"
																>
																	<XCircleIcon
																		className="size-3.5 text-danger"
																		aria-label={t(
																			"failed",
																		)}
																	/>
																	<span className="sr-only">
																		{t(
																			"failed",
																		)}
																	</span>
																</span>
															)}

															{/* Diff label */}
															{!state &&
																diffLabel ===
																	"adding" && (
																	<Description className="text-xs text-success">
																		+{" "}
																		{t(
																			"adding",
																		)}
																	</Description>
																)}
															{!state &&
																diffLabel ===
																	"removing" && (
																	<Description className="text-xs text-danger">
																		&minus;{" "}
																		{t(
																			"removing",
																		)}
																	</Description>
																)}
															{!state &&
																diffLabel ===
																	"installed" && (
																	<Description className="text-xs text-muted">
																		{t(
																			"alreadyAdded",
																		)}
																	</Description>
																)}
															{state?.status ===
																"error" &&
																state.error && (
																	<Description
																		className="text-xs text-danger"
																		role="alert"
																		aria-live="assertive"
																	>
																		{
																			state.error
																		}
																	</Description>
																)}
														</div>
													</Checkbox.Content>
												</Checkbox>
											);
										})}
									</div>
								</CheckboxGroup>
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

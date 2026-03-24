import {
	CheckCircleIcon,
	ArrowPathIcon,
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
import { createApi } from "../lib/api";
import type { McpResponse } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { AgentIcon } from "../lib/agent-icons";
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

	const usableAgents = useMemo(
		() => availableAgents.filter((a) => a.isUsable),
		[availableAgents],
	);

	const initialAgentIdsRef = useRef<Set<string>>(new Set());
	const prevIsOpenRef = useRef(false);
	const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
	const [agentStates, setAgentStates] = useState<
		Record<string, AgentState>
	>({});
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

	const handleApply = async () => {
		setIsApplying(true);
		const primary = group.items[0];

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

		await Promise.all(
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
					successCount++;
					setAgentStates((prev) => ({
						...prev,
						[id]: { status: "success" },
					}));
				} catch (err) {
					errorCount++;
					setAgentStates((prev) => ({
						...prev,
						[id]: {
							status: "error",
							error:
								err instanceof Error
									? err.message
									: String(err),
						},
					}));
				}
			}),
		);

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

	const onCloseAndReset = () => {
		setAgentStates({});
		setIsApplying(false);
		onClose();
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onCloseAndReset}>
			<Modal.Container>
				<Modal.Dialog className="max-w-md">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("manageAgents")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body>
						{usableAgents.length === 0 ? (
							<p className="text-sm text-muted">
								{t("noTargetAgents")}
							</p>
						) : (
							<CheckboxGroup
								value={selectedAgents}
								onChange={(values) =>
									setSelectedAgents(values as string[])
								}
								isDisabled={isApplying}
							>
								<Label className="sr-only">
									{t("selectAgentsForMcp")}
								</Label>
								<div className="space-y-1">
									{usableAgents.map((agent) => {
										const diffLabel = getAgentDiffLabel(
											agent.id,
										);
										const state = agentStates[agent.id];

										return (
											<Checkbox
												key={agent.id}
												value={agent.id}
												className={cn(
													"w-full cursor-pointer rounded-lg border border-transparent px-3 py-2.5 transition-colors",
													"data-[selected]:border-accent/20 data-[selected]:bg-accent-soft/50",
													"hover:bg-surface-secondary",
												)}
											>
												<Checkbox.Control>
													<Checkbox.Indicator />
												</Checkbox.Control>
												<Checkbox.Content className="flex-1">
													<div className="flex items-center justify-between">
														<div className="flex items-center gap-2">
															<AgentIcon
																id={agent.id}
																name={
																	agent.display_name
																}
																size="sm"
																variant="ghost"
															/>
															<Label>
																{
																	agent.display_name
																}
															</Label>
														</div>
														<div className="flex items-center gap-1.5">
															{/* Status indicator during apply */}
															{state?.status ===
																"pending" && (
																<ArrowPathIcon className="size-3.5 animate-spin text-muted" />
															)}
															{state?.status ===
																"success" && (
																<CheckCircleIcon className="size-3.5 text-success" />
															)}
															{state?.status ===
																"error" && (
																<XCircleIcon className="size-3.5 text-danger" />
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
														</div>
													</div>
													{state?.status ===
														"error" &&
														state.error && (
															<Description className="mt-1 text-xs text-danger">
																{state.error}
															</Description>
														)}
												</Checkbox.Content>
											</Checkbox>
										);
									})}
								</div>
							</CheckboxGroup>
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
							{isApplying
								? t("applying")
								: t("applyChanges")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

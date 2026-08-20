import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { Button, Label, ListBox, Modal, Select, toast } from "@heroui/react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	OperationBatchResponse,
	TargetDto,
	TransportDto,
} from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useProjects } from "../hooks/use-projects";
import {
	supportsMcpScope,
	supportsMcpTransport,
	supportsIndividualSkillTarget,
	supportsSubAgentScope,
} from "../lib/agent-capabilities";
import { cn } from "../lib/utils";
import {
	invalidateMcpQueries,
	mcpListQueryOptions,
	transferMcpsMutationOptions,
} from "../requests/mcps";
import {
	invalidateSkillQueries,
	skillListQueryOptions,
	transferSkillsMutationOptions,
} from "../requests/skills";
import {
	skillTargetIds,
	UNIVERSAL_SKILL_TARGET_ID,
} from "../lib/skill-targets";
import {
	invalidateSubAgentQueries,
	subAgentListQueryOptions,
	transferSubAgentsMutationOptions,
} from "../requests/sub-agents";
import { type AgentDiffLabel, AgentList, type AgentState } from "./agent-list";
import { SkillsAgentList } from "./skills-agent-list";

type ResourceKind = "mcp" | "skill" | "sub_agent";
type DestinationScope =
	{ type: "global" } | { type: "project"; path: string; name: string };

export interface TransferItem {
	name: string;
	sourceAgent: string;
	transport?: TransportDto;
}

interface TransferDialogProps {
	isOpen: boolean;
	onClose: () => void;
	resourceType: ResourceKind;
	items: TransferItem[];
	sourceScope: "global" | "project";
	sourceProjectRoot?: string;
}

export function TransferDialog({
	isOpen,
	onClose,
	resourceType,
	items,
	sourceScope,
	sourceProjectRoot,
}: TransferDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const { data: projects = [] } = useProjects();
	const transferMcpsMutation = useMutation(
		transferMcpsMutationOptions({
			api,
			queryClient,
		}),
	);
	const transferSkillsMutation = useMutation(
		transferSkillsMutationOptions({
			api,
			queryClient,
		}),
	);
	const transferSubAgentsMutation = useMutation(
		transferSubAgentsMutationOptions({
			api,
			queryClient,
		}),
	);

	const [selectedScopeKey, setSelectedScopeKey] = useState<string | null>(
		null,
	);
	const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
	const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
		{},
	);
	const [isApplying, setIsApplying] = useState(false);
	const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

	const availableDestinations = useMemo((): DestinationScope[] => {
		if (sourceScope === "global") {
			return projects.map((p) => ({
				type: "project" as const,
				path: p.path,
				name: p.name,
			}));
		}
		const result: DestinationScope[] = [{ type: "global" }];
		for (const p of projects) {
			if (p.path !== sourceProjectRoot) {
				result.push({ type: "project", path: p.path, name: p.name });
			}
		}
		return result;
	}, [sourceScope, sourceProjectRoot, projects]);

	const destinationQueries = useQueries({
		queries: availableDestinations.map((dest) => {
			const scope = dest.type;
			const projectRoot = dest.type === "project" ? dest.path : undefined;
			if (resourceType === "mcp") {
				return mcpListQueryOptions({
					api,
					scope,
					projectRoot,
					enabled: isOpen,
				});
			}
			if (resourceType === "sub_agent") {
				return subAgentListQueryOptions({
					api,
					scope,
					projectRoot,
					enabled: isOpen,
				});
			}
			return skillListQueryOptions({
				api,
				scope,
				projectRoot,
				enabled: isOpen,
				discovery: {
					projectSkills: true,
					embeddedSkills: false,
					dependencySkills: false,
				},
			});
		}),
	});

	const installedAgentsByDestination = useMemo(() => {
		const itemNames = new Set(items.map((item) => item.name));
		const map = new Map<string, Set<string>>();
		availableDestinations.forEach((dest, index) => {
			const data = destinationQueries[index]?.data;
			if (!data) {
				map.set(
					dest.type === "global" ? "global" : dest.path,
					new Set(),
				);
				return;
			}
			const namesByAgent = new Map<string, Set<string>>();
			for (const entry of data) {
				if (!itemNames.has(entry.name)) continue;
				const targetIds =
					resourceType === "skill" && "is_symlink" in entry
						? skillTargetIds(entry)
						: new Set(entry.agent ? [entry.agent] : []);
				for (const targetId of targetIds) {
					const names =
						namesByAgent.get(targetId) ?? new Set<string>();
					names.add(entry.name);
					namesByAgent.set(targetId, names);
				}
			}
			const agentSet = new Set<string>();
			for (const [agent, names] of namesByAgent) {
				if (names.size === itemNames.size) {
					agentSet.add(agent);
				}
			}
			map.set(dest.type === "global" ? "global" : dest.path, agentSet);
		});
		return map;
	}, [availableDestinations, destinationQueries, items, resourceType]);

	const selectedScope = useMemo<DestinationScope | null>(() => {
		if (!selectedScopeKey) return null;
		if (selectedScopeKey === "global") {
			return { type: "global" };
		}
		const project = projects.find((p) => p.path === selectedScopeKey);
		if (project) {
			return { type: "project", path: project.path, name: project.name };
		}
		return null;
	}, [selectedScopeKey, projects]);

	const usableAgents = useMemo(
		() =>
			(availableAgents ?? []).filter((agent) => {
				if (!agent?.isUsable) return false;
				if (!selectedScope) {
					if (resourceType === "mcp") {
						return items.every((item) =>
							supportsMcpTransport(agent, item.transport),
						);
					}
					if (resourceType === "sub_agent") {
						return (
							supportsSubAgentScope(agent, "global") ||
							supportsSubAgentScope(agent, "project")
						);
					}
					return (
						supportsIndividualSkillTarget(agent, "global") ||
						supportsIndividualSkillTarget(agent, "project")
					);
				}

				if (resourceType === "mcp") {
					return (
						supportsMcpScope(agent, selectedScope.type) &&
						items.every((item) =>
							supportsMcpTransport(agent, item.transport),
						)
					);
				}

				if (resourceType === "sub_agent") {
					return supportsSubAgentScope(agent, selectedScope.type);
				}

				return supportsIndividualSkillTarget(agent, selectedScope.type);
			}),
		[availableAgents, items, resourceType, selectedScope],
	);

	const destinationKey = selectedScope
		? selectedScope.type === "global"
			? "global"
			: selectedScope.path
		: null;

	const installedInDestination = useMemo(() => {
		if (!destinationKey) return new Set<string>();
		return (
			installedAgentsByDestination.get(destinationKey) ??
			new Set<string>()
		);
	}, [destinationKey, installedAgentsByDestination]);

	const diffLabels = useMemo((): Record<string, AgentDiffLabel> => {
		const labels: Record<string, AgentDiffLabel> = {};
		const targetIds =
			resourceType === "skill"
				? [
						UNIVERSAL_SKILL_TARGET_ID,
						...usableAgents.map((agent) => agent.id),
					]
				: usableAgents.map((agent) => agent.id);
		for (const targetId of targetIds) {
			const isInstalled = installedInDestination.has(targetId);
			const isSelected = selectedAgents.includes(targetId);
			if (isInstalled) {
				labels[targetId] = "installed";
			} else if (isSelected) {
				labels[targetId] = "adding";
			} else {
				labels[targetId] = "unconfigured";
			}
		}
		return labels;
	}, [usableAgents, installedInDestination, selectedAgents, resourceType]);

	const destinationLabel = useMemo(() => {
		if (!selectedScope) return "";
		if (selectedScope.type === "global") {
			return t("globalScope");
		}
		return selectedScope.name;
	}, [selectedScope, t]);

	const isLoadingDestinations = destinationQueries.some((q) => q.isFetching);

	const displayName =
		items.length === 1
			? items[0].name
			: t("itemsSelected", { count: items.length });

	if (isOpen !== prevIsOpen) {
		setPrevIsOpen(isOpen);
		if (isOpen) {
			setSelectedScopeKey(null);
			setSelectedAgents([]);
			setAgentStates({});
			setIsApplying(false);
		}
	}

	const handleAgentSelectionChange = useCallback((values: string[]) => {
		setSelectedAgents(values);
	}, []);

	const onCloseAndReset = () => {
		setAgentStates({});
		setIsApplying(false);
		onClose();
	};

	const handleTransfer = async () => {
		if (!selectedScope || selectedAgents.length === 0) return;

		setIsApplying(true);

		const pendingStates: Record<string, AgentState> = {};
		for (const agentId of selectedAgents) {
			pendingStates[agentId] = { status: "pending" };
		}
		setAgentStates(pendingStates);

		const destinationTargets: TargetDto[] = selectedAgents.map(
			(agentId) => ({
				agent: agentId,
				scope: selectedScope.type,
				project_root:
					selectedScope.type === "project"
						? selectedScope.path
						: null,
			}),
		);

		try {
			// Each transfer read-modify-writes the same destination config
			// file, so run them sequentially — parallel writers lose items.
			const outcomes: PromiseSettledResult<OperationBatchResponse>[] = [];
			for (const item of items) {
				const transferSource = {
					agent: item.sourceAgent,
					scope: sourceScope,
					project_root: sourceProjectRoot ?? null,
					name: item.name,
				};
				const request = {
					source: transferSource,
					destinations: destinationTargets,
				};
				try {
					const value =
						resourceType === "mcp"
							? await transferMcpsMutation.mutateAsync(request)
							: resourceType === "sub_agent"
								? await transferSubAgentsMutation.mutateAsync(
										request,
									)
								: await transferSkillsMutation.mutateAsync(
										request,
									);
					outcomes.push({ status: "fulfilled", value });
				} catch (reason) {
					outcomes.push({ status: "rejected", reason });
				}
			}

			let successCount = 0;
			let failed = 0;
			const newAgentStates: Record<string, AgentState> = {};
			for (const outcome of outcomes) {
				if (outcome.status === "rejected") {
					failed += 1;
					continue;
				}
				const result = outcome.value;
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
				if (result.failed_count > 0) {
					failed += 1;
				}
			}
			setAgentStates(newAgentStates);

			await Promise.all([
				invalidateMcpQueries(queryClient),
				invalidateSkillQueries(queryClient),
				invalidateSubAgentQueries(queryClient),
			]);

			if (failed > 0) {
				throw new Error(
					t("transfersFailed", {
						failed,
						total: items.length,
					}),
				);
			}

			toast.success(t("transferApplied", { count: successCount }));
			onCloseAndReset();
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : t("unknownError");
			toast.danger(errorMessage);
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
						<Modal.Heading>{t("transfer")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-4 space-y-4">
						<p
							className="text-sm text-muted"
							id="transfer-description"
						>
							{t("transferDescription", { name: displayName })}
						</p>

						{availableDestinations.length === 0 ? (
							<p className="text-sm text-muted">
								{t("noTransferDestinations")}
							</p>
						) : (
							<>
								<div className="space-y-2">
									<Label
										className="text-sm font-medium"
										id="destination-label"
									>
										{t("selectDestinationScope")}
									</Label>
									<Select
										variant="secondary"
										selectedKey={selectedScopeKey}
										onSelectionChange={(key) => {
											if (key) {
												setSelectedScopeKey(
													key.toString(),
												);
												setSelectedAgents([]);
												setAgentStates({});
											}
										}}
										placeholder={t(
											"selectScopePlaceholder",
										)}
										className="w-full"
										aria-labelledby="destination-label"
										aria-describedby="transfer-description"
										autoFocus
									>
										<Select.Trigger>
											<Select.Value />
											<Select.Indicator />
										</Select.Trigger>
										<Select.Popover>
											<ListBox>
												{sourceScope === "project" && (
													<ListBox.Item
														id="global"
														textValue={t(
															"globalScope",
														)}
													>
														{t("globalScope")}
													</ListBox.Item>
												)}
												{projects
													.filter(
														(p) =>
															p.path !==
															sourceProjectRoot,
													)
													.map((p) => (
														<ListBox.Item
															key={p.path}
															id={p.path}
															textValue={p.name}
														>
															{p.name}
														</ListBox.Item>
													))}
											</ListBox>
										</Select.Popover>
									</Select>
								</div>

								{selectedScope && (
									<div className="space-y-2">
										<Label
											className="text-sm font-medium"
											id="agents-label"
										>
											{t("selectAgentsForCopy", {
												destination: destinationLabel,
											})}
										</Label>
										<div
											className={cn(
												"transition-opacity",
												isApplying && "opacity-50",
											)}
										>
											{isLoadingDestinations ? (
												<div
													className="flex items-center justify-center py-8"
													aria-busy="true"
													aria-label={t(
														"loadingDestinations",
													)}
												>
													<ArrowPathIcon className="size-5 animate-spin text-muted" />
												</div>
											) : resourceType === "skill" ? (
												<SkillsAgentList
													agents={usableAgents}
													selectedKeys={
														selectedAgents
													}
													onSelectionChange={
														handleAgentSelectionChange
													}
													agentStates={agentStates}
													diffLabels={diffLabels}
													disabled={isApplying}
													disabledAgents={
														installedInDestination
													}
													label={t(
														"selectAgentsForCopy",
														{
															destination:
																destinationLabel,
														},
													)}
												/>
											) : (
												<AgentList
													agents={usableAgents}
													selectedKeys={
														selectedAgents
													}
													onSelectionChange={
														handleAgentSelectionChange
													}
													agentStates={agentStates}
													diffLabels={diffLabels}
													disabled={isApplying}
													disabledAgents={
														installedInDestination
													}
													emptyMessage={t(
														"noTargetAgents",
													)}
													labelledBy="agents-label"
												/>
											)}
										</div>
									</div>
								)}
							</>
						)}
					</Modal.Body>

					{isApplying && (
						<div className="px-4 pb-2">
							<p className="text-sm text-muted">
								{t("copyingToTargets", {
									count: selectedAgents.length,
								})}
							</p>
						</div>
					)}

					<Modal.Footer>
						<Button variant="secondary" onPress={onCloseAndReset}>
							{t("cancel")}
						</Button>
						<Button
							variant="primary"
							onPress={handleTransfer}
							isDisabled={
								!selectedScope ||
								selectedAgents.length === 0 ||
								isApplying ||
								isLoadingDestinations ||
								selectedAgents.every((id) =>
									installedInDestination.has(id),
								)
							}
						>
							{isApplying && (
								<ArrowPathIcon className="size-4 animate-spin" />
							)}
							{t("transfer")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

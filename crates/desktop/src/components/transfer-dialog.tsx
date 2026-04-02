import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { Button, Label, ListBox, Modal, Select, toast } from "@heroui/react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useProjects } from "../hooks/use-projects";
import type { InstallTarget, TransportDto } from "../lib/api-types";
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
import { type AgentDiffLabel, AgentList, type AgentState } from "./agent-list";

type ResourceKind = "mcp" | "skill";
type DestinationScope =
	| { type: "global" }
	| { type: "project"; path: string; name: string };

interface TransferDialogProps {
	isOpen: boolean;
	onClose: () => void;
	resourceType: ResourceKind;
	name: string;
	sourceAgent: string;
	sourceScope: "global" | "project";
	sourceProjectRoot?: string;
	transport?: TransportDto;
}

function supportsMcpTransport(
	transport: TransportDto | undefined,
	agent: {
		capabilities: {
			mcp_stdio: boolean;
			mcp_remote: boolean;
			skills: boolean;
		};
	},
): boolean {
	if (!transport) return false;
	if (transport.type === "stdio") return agent.capabilities.mcp_stdio;
	return agent.capabilities.mcp_remote;
}

export function TransferDialog({
	isOpen,
	onClose,
	resourceType,
	name,
	sourceAgent,
	sourceScope,
	sourceProjectRoot,
	transport,
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

	const [selectedScopeKey, setSelectedScopeKey] = useState<string | null>(
		null,
	);
	const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
	const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(
		{},
	);
	const [isApplying, setIsApplying] = useState(false);
	const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

	const usableAgents = useMemo(
		() =>
			(availableAgents ?? []).filter((agent) => {
				if (!agent?.isUsable) return false;
				if (resourceType === "mcp") {
					return supportsMcpTransport(transport, agent);
				}
				return agent.capabilities.skills;
			}),
		[availableAgents, resourceType, transport],
	);

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
		queries: availableDestinations.map((dest) =>
			resourceType === "mcp"
				? mcpListQueryOptions({
						api,
						scope: dest.type,
						projectRoot:
							dest.type === "project" ? dest.path : undefined,
						enabled: isOpen,
					})
				: skillListQueryOptions({
						api,
						scope: dest.type,
						projectRoot:
							dest.type === "project" ? dest.path : undefined,
						enabled: isOpen,
					}),
		),
	});

	const installedAgentsByDestination = useMemo(() => {
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
			const agentSet = new Set<string>();
			for (const item of data) {
				if (item.name === name && item.agent) {
					agentSet.add(item.agent);
				}
			}
			map.set(dest.type === "global" ? "global" : dest.path, agentSet);
		});
		return map;
	}, [availableDestinations, destinationQueries, name]);

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
		for (const agent of usableAgents) {
			const isInstalled = installedInDestination.has(agent.id);
			const isSelected = selectedAgents.includes(agent.id);
			if (isInstalled) {
				labels[agent.id] = "installed";
			} else if (isSelected) {
				labels[agent.id] = "adding";
			} else {
				labels[agent.id] = "unconfigured";
			}
		}
		return labels;
	}, [usableAgents, installedInDestination, selectedAgents]);

	const destinationLabel = useMemo(() => {
		if (!selectedScope) return "";
		if (selectedScope.type === "global") {
			return t("globalScope");
		}
		return selectedScope.name;
	}, [selectedScope, t]);

	const isLoadingDestinations = destinationQueries.some((q) => q.isFetching);

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

		const destinationTargets: InstallTarget[] = selectedAgents.map(
			(agentId) => ({
				agent: agentId,
				scope: selectedScope.type === "global" ? "global" : "project",
				project_root:
					selectedScope.type === "project"
						? selectedScope.path
						: undefined,
			}),
		);

		try {
			const result =
				resourceType === "mcp"
					? await transferMcpsMutation.mutateAsync({
							source: {
								agent: sourceAgent,
								scope: sourceScope,
								project_root: sourceProjectRoot,
								name,
							},
							destinations: destinationTargets,
						})
					: await transferSkillsMutation.mutateAsync({
							source: {
								agent: sourceAgent,
								scope: sourceScope,
								project_root: sourceProjectRoot,
								name,
							},
							destinations: destinationTargets,
						});

			const newAgentStates: Record<string, AgentState> = {};
			for (const item of result.results) {
				newAgentStates[item.agent] = {
					status: item.success ? "success" : "error",
					error: item.error ?? undefined,
				};
			}
			setAgentStates(newAgentStates);

			await Promise.all([
				invalidateMcpQueries(queryClient),
				invalidateSkillQueries(queryClient),
			]);

			if (result.failed_count === 0) {
				toast.success(
					t("transferApplied", { count: result.success_count }),
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
							{t("transferDescription", { name })}
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

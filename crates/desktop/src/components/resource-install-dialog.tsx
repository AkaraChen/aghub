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
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useProjects } from "../hooks/use-projects";
import { useServer } from "../hooks/use-server";
import { AgentIcon } from "../lib/agent-icons";
import { createApi } from "../lib/api";
import type {
	InstallTarget,
	McpResponse,
	OperationBatchResponse,
	ReconcileTarget,
	SkillResponse,
	TransportDto,
} from "../lib/api-types";
import { cn } from "../lib/utils";

type ResourceKind = "mcp" | "skill";
type DialogMode = "transfer" | "manage";
type AgentStatus = "idle" | "pending" | "success" | "error";

interface OptionState {
	status: AgentStatus;
	error?: string;
}

interface ResourceInstallDialogProps {
	isOpen: boolean;
	onClose: () => void;
	mode: DialogMode;
	resourceType: ResourceKind;
	name: string;
	sourceAgent: string;
	sourceScope: "global" | "project";
	sourceProjectRoot?: string;
	transport?: TransportDto;
}

interface InstallOption {
	key: string;
	agent: string;
	agentName: string;
	scope: "global" | "project";
	projectRoot?: string;
	locationLabel: string;
	installed: boolean;
}

function targetKey(target: {
	agent: string;
	scope: "global" | "project";
	projectRoot?: string;
}) {
	return `${target.agent}|${target.scope}|${target.projectRoot ?? ""}`;
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
) {
	if (!transport) {
		return false;
	}
	if (transport.type === "stdio") {
		return agent.capabilities.mcp_stdio;
	}
	return agent.capabilities.mcp_remote;
}

export function ResourceInstallDialog({
	isOpen,
	onClose,
	mode,
	resourceType,
	name,
	sourceAgent,
	sourceScope,
	sourceProjectRoot,
	transport,
}: ResourceInstallDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const { data: projects = [] } = useProjects();
	const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
	const [optionStates, setOptionStates] = useState<
		Record<string, OptionState>
	>({});
	const [isApplying, setIsApplying] = useState(false);

	const locations = useMemo(
		() => [
			{
				id: "global",
				scope: "global" as const,
				projectRoot: undefined,
				label: t("globalScope"),
			},
			...projects.map((project) => ({
				id: project.id,
				scope: "project" as const,
				projectRoot: project.path,
				label: project.name,
			})),
		],
		[projects, t],
	);

	const installationQueries = useQueries({
		queries: locations.map((location) => ({
			queryKey: [
				resourceType,
				"installations",
				location.scope,
				location.projectRoot ?? "global",
			],
			queryFn: () =>
				resourceType === "mcp"
					? api.mcps.listAll(location.scope, location.projectRoot)
					: api.skills.listAll(location.scope, location.projectRoot),
			staleTime: 30_000,
			enabled: isOpen,
		})),
	});

	const installedTargets = useMemo(() => {
		const keys = new Set<string>();
		installationQueries.forEach((query, index) => {
			const location = locations[index];
			const items = (query.data ?? []) as Array<
				McpResponse | SkillResponse
			>;
			items
				.filter((item) => item.name === name && item.agent)
				.forEach((item) => {
					keys.add(
						targetKey({
							agent: item.agent!,
							scope: location.scope,
							projectRoot: location.projectRoot,
						}),
					);
				});
		});
		return keys;
	}, [installationQueries, locations, name]);

	const options = useMemo(() => {
		return locations.flatMap((location) =>
			(availableAgents ?? [])
				.filter((agent) => {
					if (!agent?.isUsable) {
						return false;
					}
					if (resourceType === "mcp") {
						return supportsMcpTransport(transport, agent);
					}
					return agent.capabilities.skills;
				})
				.map((agent) => ({
					key: targetKey({
						agent: agent.id,
						scope: location.scope,
						projectRoot: location.projectRoot,
					}),
					agent: agent.id,
					agentName: agent.display_name,
					scope: location.scope,
					projectRoot: location.projectRoot,
					locationLabel: location.label,
					installed: installedTargets.has(
						targetKey({
							agent: agent.id,
							scope: location.scope,
							projectRoot: location.projectRoot,
						}),
					),
				})),
		);
	}, [availableAgents, installedTargets, locations, resourceType, transport]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		setOptionStates({});
		setSelectedKeys(
			mode === "manage"
				? options.filter((option) => option.installed).map((o) => o.key)
				: [],
		);
	}, [isOpen, mode, options]);

	const handleApply = async () => {
		setIsApplying(true);
		let result: OperationBatchResponse;
		try {
			if (resourceType === "mcp") {
				result =
					mode === "transfer"
						? await api.mcps.transfer({
								source: {
									agent: sourceAgent,
									scope: sourceScope,
									project_root: sourceProjectRoot,
									name,
								},
								destinations: options
									.filter((option) =>
										selectedKeys.includes(option.key),
									)
									.map<InstallTarget>((option) => ({
										agent: option.agent,
										scope: option.scope,
										project_root: option.projectRoot,
									})),
							})
						: await api.mcps.reconcile({
								source: {
									agent: sourceAgent,
									scope: sourceScope,
									project_root: sourceProjectRoot,
									name,
								},
								targets: options.map<ReconcileTarget>(
									(option) => ({
										agent: option.agent,
										scope: option.scope,
										project_root: option.projectRoot,
										selected: selectedKeys.includes(
											option.key,
										),
									}),
								),
							});
			} else {
				result =
					mode === "transfer"
						? await api.skills.transfer({
								source: {
									agent: sourceAgent,
									scope: sourceScope,
									project_root: sourceProjectRoot,
									name,
								},
								destinations: options
									.filter((option) =>
										selectedKeys.includes(option.key),
									)
									.map<InstallTarget>((option) => ({
										agent: option.agent,
										scope: option.scope,
										project_root: option.projectRoot,
									})),
							})
						: await api.skills.reconcile({
								source: {
									agent: sourceAgent,
									scope: sourceScope,
									project_root: sourceProjectRoot,
									name,
								},
								targets: options.map<ReconcileTarget>(
									(option) => ({
										agent: option.agent,
										scope: option.scope,
										project_root: option.projectRoot,
										selected: selectedKeys.includes(
											option.key,
										),
									}),
								),
							});
			}

			setOptionStates(
				Object.fromEntries(
					result.results.map((item) => [
						targetKey({
							agent: item.agent,
							scope: item.scope,
							projectRoot: item.project_root,
						}),
						{
							status: item.success ? "success" : "error",
							error: item.error,
						},
					]),
				),
			);

			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["mcps"] }),
				queryClient.invalidateQueries({ queryKey: ["project-mcps"] }),
				queryClient.invalidateQueries({ queryKey: ["skill-locks"] }),
				queryClient.invalidateQueries({ queryKey: ["project-skills"] }),
				queryClient.invalidateQueries({ queryKey: ["skills"] }),
			]);

			if (result.failed_count === 0) {
				toast.success(
					mode === "transfer"
						? t("transferApplied", { count: result.success_count })
						: t("agentChangesApplied", {
								count: result.success_count,
							}),
				);
				onClose();
			} else {
				toast.danger(
					t("agentChangesFailed", {
						success: result.success_count,
						failed: result.failed_count,
					}),
				);
			}
		} catch (error) {
			toast.danger(
				error instanceof Error ? error.message : t("unknownError"),
			);
		} finally {
			setIsApplying(false);
		}
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog className="w-[calc(100vw-2rem)] max-w-2xl">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>
							{mode === "transfer"
								? t("transfer")
								: t("addToAgent")}
						</Modal.Heading>
					</Modal.Header>
					<Modal.Body className="p-4">
						<CheckboxGroup
							value={selectedKeys}
							onChange={(values) =>
								setSelectedKeys(values as string[])
							}
							isDisabled={isApplying}
						>
							<Label className="sr-only">
								{t("selectTargets")}
							</Label>
							<div className="grid gap-2 sm:grid-cols-2">
								{options.map((option) => {
									const state = optionStates[option.key];
									const disabled =
										mode === "transfer" && option.installed;
									return (
										<Checkbox
											key={option.key}
											value={option.key}
											isDisabled={disabled}
											variant="secondary"
											className={cn(
												"group relative flex w-full flex-col items-stretch gap-2 rounded-2xl bg-surface px-3 py-2.5 transition-all",
												"data-[selected=true]:bg-accent/10",
											)}
										>
											<Checkbox.Control className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full before:rounded-full">
												<Checkbox.Indicator />
											</Checkbox.Control>
											<Checkbox.Content className="flex flex-row items-start gap-3">
												<AgentIcon
													id={option.agent}
													name={option.agentName}
													size="sm"
													variant="ghost"
												/>
												<div className="flex flex-1 flex-col gap-0.5">
													<Label className="truncate text-sm">
														{option.agentName}
													</Label>
													<Description className="text-xs text-muted">
														{option.locationLabel}
													</Description>
													{state?.status ===
														"success" && (
														<Description className="flex items-center gap-1 text-xs text-success">
															<CheckCircleIcon className="size-3.5" />
															{t("success")}
														</Description>
													)}
													{state?.status ===
														"error" && (
														<Description className="flex items-center gap-1 text-xs text-danger">
															<XCircleIcon className="size-3.5" />
															{state.error ??
																t("failed")}
														</Description>
													)}
													{!state &&
														option.installed && (
															<Description className="text-xs text-muted">
																{disabled
																	? t(
																			"alreadyInstalled",
																		)
																	: t(
																			"installed",
																		)}
															</Description>
														)}
												</div>
											</Checkbox.Content>
										</Checkbox>
									);
								})}
							</div>
						</CheckboxGroup>
					</Modal.Body>
					<Modal.Footer>
						<Button variant="secondary" onPress={onClose}>
							{t("cancel")}
						</Button>
						<Button
							variant="primary"
							onPress={handleApply}
							isDisabled={isApplying}
						>
							{isApplying && (
								<ArrowPathIcon className="size-4 animate-spin" />
							)}
							{mode === "transfer" ? t("transfer") : t("apply")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

import {
	Button,
	Modal,
	type Selection,
	Spinner,
	Tag,
	TagGroup,
} from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createApi } from "../lib/api";
import type { McpResponse } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { capitalize } from "../lib/mcp-utils";
import { useAgentAvailability } from "../providers/agent-availability";
import { useServer } from "../providers/server";
import { ResultStatusItem } from "./result-status-item";
import { StepIndicator } from "./step-indicator";
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon } from "@heroicons/react/24/solid";

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

type WizardStep = 1 | 2 | 3;

interface AgentResult {
	agentId: string;
	displayName: string;
	action: "install" | "uninstall";
	status: "pending" | "success" | "error";
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
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const usableAgents = useMemo(
		() => availableAgents.filter((a) => a.isUsable),
		[availableAgents],
	);

	const [step, setStep] = useState<WizardStep>(1);
	const initialAgentIdsRef = useRef<Set<string> | null>(null);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
		() => initialAgentIdsRef.current ?? new Set(),
	);
	const [results, setResults] = useState<AgentResult[]>([]);

	if (isOpen && initialAgentIdsRef.current === null) {
		initialAgentIdsRef.current = new Set(
			group.items.map((item) => item.agent ?? "default"),
		);
		setSelectedAgents(new Set(initialAgentIdsRef.current));
	}

	if (!isOpen && initialAgentIdsRef.current !== null) {
		initialAgentIdsRef.current = null;
	}

	const currentAgentIds = initialAgentIdsRef.current ?? new Set<string>();

	const toInstall = [...selectedAgents].filter(
		(id) => !currentAgentIds.has(id),
	);
	const toUninstall = [...currentAgentIds].filter(
		(id) => !selectedAgents.has(id),
	);
	const hasChanges = toInstall.length > 0 || toUninstall.length > 0;

	const agentNameMap = useMemo(
		() => new Map(availableAgents.map((a) => [a.id, a.display_name])),
		[availableAgents],
	);

	const getAgentDisplayName = useMemo(() => {
		return (agentId: string) => {
			return agentNameMap.get(agentId) ?? capitalize(agentId);
		};
	}, [agentNameMap]);

	const handleSelectionChange = (keys: Selection) => {
		const newKeys = keys as Set<string>;
		if (newKeys.size >= 1) {
			setSelectedAgents(newKeys);
		}
	};

	const handleApply = async () => {
		setStep(3);

		const primary = group.items[0];
		const pendingResults: AgentResult[] = [
			...toInstall.map((id) => ({
				agentId: id,
				displayName: getAgentDisplayName(id),
				action: "install" as const,
				status: "pending" as const,
			})),
			...toUninstall.map((id) => ({
				agentId: id,
				displayName: getAgentDisplayName(id),
				action: "uninstall" as const,
				status: "pending" as const,
			})),
		];
		setResults(pendingResults);

		const updatedResults = await Promise.all(
			pendingResults.map(async (result) => {
				try {
					if (result.action === "install") {
						const scope = projectPath ? "project" : "global";
						await api.mcps.create(
							result.agentId,
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
								(i) => (i.agent ?? "default") === result.agentId,
							)?.source === ConfigSource.Project
								? "project"
								: "global";
						await api.mcps.delete(
							primary.name,
							result.agentId,
							scope,
							projectPath,
						);
					}
					return { ...result, status: "success" as const };
				} catch (err) {
					return {
						...result,
						status: "error" as const,
						error: err instanceof Error ? err.message : String(err),
					};
				}
			}),
		);

		setResults(updatedResults);
		queryClient.invalidateQueries({ queryKey: ["mcps"] });
	};

	const handleClose = () => {
		setStep(1);
		setSelectedAgents(new Set(currentAgentIds));
		setResults([]);
		onClose();
	};

	const stepLabels = [t("selectAgents"), t("confirmChanges"), t("result")];

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
			<Modal.Container>
				<Modal.Dialog className="max-w-xl">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("manageAgents")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-2">
						<StepIndicator currentStep={step} labels={stepLabels} />

						{step === 1 && (
							<div>
								<p className="text-sm text-muted mb-3">
									{t("selectAgentsForMcp")}
								</p>
								{usableAgents.length === 0 ? (
									<p className="text-sm text-muted">
										{t("noTargetAgents")}
									</p>
								) : (
									<TagGroup
										selectionMode="multiple"
										selectedKeys={selectedAgents}
										onSelectionChange={
											handleSelectionChange
										}
									>
										<TagGroup.List className="flex-wrap">
											{usableAgents.map((agent) => {
												const isSelected =
													selectedAgents.has(
														agent.id,
													);
												const isCurrentAgent =
													currentAgentIds.has(
														agent.id,
													);
												const isAdding =
													isSelected &&
													!isCurrentAgent;
												const isRemoving =
													!isSelected &&
													isCurrentAgent;
												return (
													<Tag
														key={agent.id}
														id={agent.id}
													>
														<div className="flex items-center gap-1.5">
															{agent.display_name}
															{isAdding && (
																<PlusIcon className="size-3" />
															)}
															{isRemoving && (
																<MinusIcon className="size-3" />
															)}
														</div>
													</Tag>
												);
											})}
										</TagGroup.List>
									</TagGroup>
								)}
							</div>
						)}

						{step === 2 && (
							<div className="space-y-4">
								{toInstall.length > 0 && (
									<div>
										<p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
											{t("toInstall")}
										</p>
										<TagGroup selectionMode="none">
											<TagGroup.List className="flex-wrap">
												{toInstall.map((id) => (
													<Tag
														key={id}
														id={id}
														className="bg-success-soft text-success border-success/30"
													>
														<div className="flex items-center gap-1.5">
															{getAgentDisplayName(
																id,
															)}
															<PlusIcon className="size-3" />
														</div>
													</Tag>
												))}
											</TagGroup.List>
										</TagGroup>
									</div>
								)}
								{toUninstall.length > 0 && (
									<div>
										<p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
											{t("toUninstall")}
										</p>
										<TagGroup selectionMode="none">
											<TagGroup.List className="flex-wrap">
												{toUninstall.map((id) => (
													<Tag
														key={id}
														id={id}
														className="bg-danger-soft text-danger border-danger/30"
													>
														<div className="flex items-center gap-1.5">
															{getAgentDisplayName(
																id,
															)}
															<MinusIcon className="size-3" />
														</div>
													</Tag>
												))}
											</TagGroup.List>
										</TagGroup>
									</div>
								)}
							</div>
						)}

						{step === 3 && (
							<div className="space-y-2">
								{results.length === 0 && (
									<p className="text-sm text-muted">
										{t("noChanges")}
									</p>
								)}
								{results.some(
									(r) => r.status === "pending",
								) && (
									<div className="flex items-center justify-center py-6">
										<Spinner size="lg" />
									</div>
								)}
								{results.map((result) => (
									<ResultStatusItem
										key={result.agentId}
										displayName={result.displayName}
										status={result.status}
										statusText={
											result.status === "pending"
												? result.action === "install"
													? t("installing")
													: t("uninstalling")
												: result.status === "success"
													? result.action === "install"
														? t("installSuccess")
														: t("uninstallSuccess")
													: ""
										}
										error={result.error}
									/>
								))}
							</div>
						)}
					</Modal.Body>

					<Modal.Footer>
						{step === 1 && (
							<>
								<Button slot="close" variant="secondary">
									{t("cancel")}
								</Button>
								<Button
									onPress={() => setStep(2)}
									isDisabled={!hasChanges}
								>
									{t("next")}
									<ChevronRightIcon className="size-3.5" />
								</Button>
							</>
						)}
						{step === 2 && (
							<>
								<Button
									variant="secondary"
									onPress={() => setStep(1)}
								>
									<ChevronLeftIcon className="size-3.5" />
									{t("back")}
								</Button>
								<Button
									onPress={handleApply}
									isDisabled={!hasChanges}
								>
									{t("apply")}
									<ChevronRightIcon className="size-3.5" />
								</Button>
							</>
						)}
						{step === 3 && (
							<Button slot="close" variant="secondary">
								{t("done")}
							</Button>
						)}
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

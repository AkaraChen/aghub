import { Alert, Button, Card, Modal } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useInstallTarget } from "../hooks/use-install-target";
import { useServer } from "../hooks/use-server";
import { supportsMcp } from "../lib/agent-capabilities";
import { createApi } from "../lib/api";
import type { TransportDto } from "../lib/api-types";
import {
	type DeepLinkImportIntent,
	formatTransportSummary,
} from "../lib/deep-link";
import { AgentSelector } from "./agent-selector";
import { InstallTargetSelector } from "./install-target-selector";
import { ResultStatusItem } from "./result-status-item";
import { SkillInfoCard } from "./skill-info-card";

interface DeepLinkImportModalProps {
	intent: DeepLinkImportIntent | null;
	onClose: () => void;
}

interface InstallResult {
	agentId: string;
	displayName: string;
	status: "pending" | "success" | "error";
	error?: string;
}

interface InstallVariables {
	intent: DeepLinkImportIntent;
	selectedAgents: Set<string>;
	installToProject: boolean;
	selectedProject: { id: string; path: string } | null;
}

function transportLabel(transport: TransportDto): string {
	if (transport.type === "streamable_http") {
		return "Streamable HTTP";
	}

	return transport.type.toUpperCase();
}

function buildPendingResults(
	selectedAgents: Set<string>,
	compatibleAgents: Array<{ id: string; display_name: string }>,
): InstallResult[] {
	return Array.from(selectedAgents, (agentId) => {
		const agent = compatibleAgents.find((item) => item.id === agentId);
		return {
			agentId,
			displayName: agent?.display_name ?? agentId,
			status: "pending" as const,
		};
	});
}

export function DeepLinkImportModal({
	intent,
	onClose,
}: DeepLinkImportModalProps) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const { availableAgents } = useAgentAvailability();
	const {
		projects,
		installToProject,
		setInstallToProject,
		selectedProjectId,
		selectedProject,
		canInstallToProject,
		setSelectedProjectId,
		resetInstallTarget,
	} = useInstallTarget();

	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
		() => new Set(),
	);

	const compatibleAgents = useMemo(() => {
		if (!intent) {
			return [];
		}

		if (intent.kind === "skill-market-install") {
			return availableAgents.filter(
				(agent) => agent.isUsable && agent.capabilities.skills_mutable,
			);
		}

		return availableAgents.filter(
			(agent) => agent.isUsable && supportsMcp(agent),
		);
	}, [availableAgents, intent]);

	const defaultSelectedAgents = useMemo<Set<string>>(() => {
		return compatibleAgents[0]
			? new Set([compatibleAgents[0].id])
			: new Set();
	}, [compatibleAgents]);

	const installMutation = useMutation<
		InstallResult[],
		Error,
		InstallVariables,
		{ pendingResults: InstallResult[] }
	>({
		mutationFn: async (variables: InstallVariables) => {
			const pendingResults = buildPendingResults(
				variables.selectedAgents,
				compatibleAgents,
			);

			if (variables.intent.kind === "skill-market-install") {
				const response = await api.skills.install({
					source: variables.intent.source,
					agents: Array.from(variables.selectedAgents),
					skills: [variables.intent.name],
					scope: variables.installToProject ? "project" : "global",
					project_path: variables.selectedProject?.path,
				});

				return pendingResults.map((result) => ({
					...result,
					status: (response.success ? "success" : "error") as
						| "success"
						| "error",
					error: response.success ? undefined : response.stderr,
				}));
			}

			const scope = variables.installToProject ? "project" : "global";
			const projectRoot = variables.selectedProject?.path;
			const body = {
				name: variables.intent.name,
				transport: variables.intent.transport,
				timeout: variables.intent.timeout,
			};

			await Promise.all(
				Array.from(variables.selectedAgents).map((agent) =>
					api.mcps.create(agent, scope, body, projectRoot),
				),
			);

			return pendingResults.map((result) => ({
				...result,
				status: "success" as const,
			}));
		},
		onMutate: (variables) => {
			const pendingResults = buildPendingResults(
				variables.selectedAgents,
				compatibleAgents,
			);
			return { pendingResults };
		},
		onSuccess: () => {
			if (intent?.kind === "skill-market-install") {
				queryClient.invalidateQueries({ queryKey: ["skills"] });
				queryClient.invalidateQueries({ queryKey: ["project-skills"] });
				queryClient.invalidateQueries({ queryKey: ["skill-locks"] });
			} else {
				queryClient.invalidateQueries({ queryKey: ["mcps"] });
				queryClient.invalidateQueries({ queryKey: ["project-mcps"] });
			}
		},
	});

	const handleInstall = () => {
		if (!intent || installMutation.isPending) {
			return;
		}

		installMutation.mutate({
			intent,
			selectedAgents,
			installToProject,
			selectedProject,
		});
	};

	const handleClose = () => {
		setSelectedAgents(new Set());
		installMutation.reset();
		resetInstallTarget();
		onClose();
	};

	const handleModalOpenChange = (isOpen: boolean) => {
		if (!isOpen) {
			handleClose();
		} else if (isOpen && intent) {
			setSelectedAgents(defaultSelectedAgents);
			resetInstallTarget();
		}
	};

	const results =
		installMutation.data ?? installMutation.context?.pendingResults ?? [];
	const isInstalling = installMutation.isPending;
	const error = installMutation.error?.message ?? null;

	return (
		<Modal.Backdrop
			isOpen={Boolean(intent)}
			onOpenChange={handleModalOpenChange}
		>
			<Modal.Container>
				<Modal.Dialog className="max-w-md">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("reviewImport")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="space-y-4 p-2">
						{error && (
							<Alert status="danger">
								<Alert.Indicator />
								<Alert.Content>
									<Alert.Description>
										{error}
									</Alert.Description>
								</Alert.Content>
							</Alert>
						)}

						{intent?.kind === "skill-market-install" && (
							<div className="space-y-3">
								<SkillInfoCard
									name={intent.title || intent.name}
									source={intent.source}
								/>
								{intent.description && (
									<p className="text-sm text-muted">
										{intent.description}
									</p>
								)}
								{intent.author && (
									<p className="text-xs text-muted">
										{t("author")}: {intent.author}
									</p>
								)}
							</div>
						)}

						{intent?.kind === "mcp-config-install" && (
							<Card>
								<Card.Header>
									<div>
										<p className="text-sm text-muted">
											{t("mcp")}
										</p>
										<h3 className="text-base font-semibold">
											{intent.name}
										</h3>
									</div>
								</Card.Header>
								<Card.Content className="space-y-2 text-sm">
									<div className="flex items-center justify-between gap-3">
										<span className="text-muted">
											{t("type")}
										</span>
										<span>
											{transportLabel(intent.transport)}
										</span>
									</div>
									<div className="space-y-1">
										<p className="text-muted">
											{t("details")}
										</p>
										<p className="break-all rounded-lg bg-surface-secondary px-3 py-2 text-foreground">
											{formatTransportSummary(
												intent.transport,
											)}
										</p>
									</div>
								</Card.Content>
							</Card>
						)}

						{results.length === 0 && (
							<div className="space-y-4">
								<p className="text-sm text-muted">
									{intent?.kind === "mcp-config-install"
										? t("selectAgentsForMcp")
										: t("selectAgentsForSkill")}
								</p>
								<AgentSelector
									agents={compatibleAgents}
									selectedKeys={selectedAgents}
									onSelectionChange={setSelectedAgents}
									label={t("targetAgent")}
									emptyMessage={t("noTargetAgents")}
									showSelectedIcon
									variant="secondary"
								/>
								<InstallTargetSelector
									installToProject={installToProject}
									onInstallToProjectChange={
										setInstallToProject
									}
									selectedProjectId={selectedProjectId}
									onSelectedProjectIdChange={
										setSelectedProjectId
									}
									projects={projects}
									canInstallToProject={canInstallToProject}
								/>
							</div>
						)}

						{results.length > 0 && (
							<div className="space-y-3">
								{results.map((result) => (
									<ResultStatusItem
										key={result.agentId}
										displayName={result.displayName}
										status={result.status}
										statusText={
											result.status === "pending"
												? t("installing")
												: result.status === "success"
													? t("installSuccess")
													: ""
										}
										error={result.error}
									/>
								))}
							</div>
						)}
					</Modal.Body>

					<Modal.Footer>
						{results.length === 0 ? (
							<>
								<Button slot="close" variant="secondary">
									{t("cancel")}
								</Button>
								<Button
									onPress={handleInstall}
									isDisabled={
										selectedAgents.size === 0 ||
										isInstalling ||
										(installToProject && !selectedProject)
									}
								>
									{isInstalling
										? t("installing")
										: t("install")}
								</Button>
							</>
						) : (
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

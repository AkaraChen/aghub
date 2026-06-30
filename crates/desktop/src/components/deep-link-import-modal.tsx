import { Alert, Button, Card, Modal } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TransportDto } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useInstallTarget } from "../hooks/use-install-target";
import { supportsMcp, supportsSkillMutation } from "../lib/agent-capabilities";
import {
	type DeepLinkImportIntent,
	formatTransportSummary,
} from "../lib/deep-link";
import { buildPendingResults, type InstallResult } from "../lib/install-utils";
import { queryKeys } from "../requests/keys";
import { capture } from "../lib/analytics";
import { AgentSelector } from "./agent-selector";
import { InstallTargetSelector } from "./install-target-selector";
import { ResultStatusItem } from "./result-status-item";
import { SkillInfoCard } from "./skill-info-card";

interface DeepLinkImportModalProps {
	intent: DeepLinkImportIntent | null;
	onComplete: () => void;
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

function hasMapEntries(value: Record<string, string> | null): boolean {
	return Boolean(value && Object.keys(value).length > 0);
}

function formatReviewValue(value: unknown): string {
	if (Array.isArray(value)) {
		return value.length > 0 ? JSON.stringify(value, null, 2) : "[]";
	}

	if (value && typeof value === "object") {
		return JSON.stringify(value, null, 2);
	}

	return String(value);
}

interface TransportReviewFieldProps {
	label: string;
	value: string;
}

function TransportReviewField({ label, value }: TransportReviewFieldProps) {
	return (
		<div className="space-y-1">
			<p className="text-muted">{label}</p>
			<pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-secondary px-3 py-2 font-mono text-xs text-foreground">
				{value}
			</pre>
		</div>
	);
}

export function DeepLinkImportModal({
	intent,
	onComplete,
}: DeepLinkImportModalProps) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const api = useApi();
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
	const [hasExecutableConsent, setHasExecutableConsent] = useState(false);

	const compatibleAgents = useMemo(() => {
		if (!intent) {
			return [];
		}

		if (intent.kind === "skill-market-install") {
			return availableAgents.filter(
				(agent) =>
					agent.isUsable &&
					supportsSkillMutation(
						agent,
						installToProject ? "project" : "global",
					),
			);
		}

		return availableAgents.filter(
			(agent) => agent.isUsable && supportsMcp(agent),
		);
	}, [availableAgents, installToProject, intent]);

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
					project_path: variables.selectedProject?.path ?? null,
					install_all: false,
				});

				return pendingResults.map((result) => ({
					...result,
					status: (response.success ? "success" : "error") as
						"success" | "error",
					error: response.success
						? undefined
						: t("skillInstallFailed"),
				}));
			}

			const scope = variables.installToProject ? "project" : "global";
			const projectRoot = variables.selectedProject?.path;
			const body = {
				name: variables.intent.name,
				transport: variables.intent.transport,
				timeout: variables.intent.timeout ?? null,
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
		onSuccess: (_data, variables) => {
			if (intent?.kind === "skill-market-install") {
				queryClient.invalidateQueries({
					queryKey: queryKeys.skills.all(),
				});
				capture("deep link imported", {
					import_kind: "skill",
					agents: Array.from(variables.selectedAgents),
					scope: variables.installToProject ? "project" : "global",
				});
			} else {
				queryClient.invalidateQueries({
					queryKey: queryKeys.mcps.all(),
				});
				capture("deep link imported", {
					import_kind: "mcp",
					agents: Array.from(variables.selectedAgents),
					scope: variables.installToProject ? "project" : "global",
				});
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
		if (!intent) {
			onComplete();
			return;
		}
		setSelectedAgents(new Set());
		setHasExecutableConsent(false);
		installMutation.reset();
		resetInstallTarget();
		onComplete();
	};

	const handleModalOpenChange = (isOpen: boolean) => {
		if (!isOpen) {
			handleClose();
		} else if (isOpen && intent) {
			setSelectedAgents(defaultSelectedAgents);
			setHasExecutableConsent(false);
			resetInstallTarget();
		}
	};

	const results =
		installMutation.data ?? installMutation.context?.pendingResults ?? [];
	const isInstalling = installMutation.isPending;
	const error = installMutation.error?.message ?? null;
	const requiresExecutableConsent =
		intent?.kind === "mcp-config-install" &&
		intent.transport.type === "stdio";

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
							<div className="space-y-3">
								{requiresExecutableConsent && (
									<Alert status="warning">
										<Alert.Indicator />
										<Alert.Content>
											<Alert.Title>
												{t("executableMcpWarningTitle")}
											</Alert.Title>
											<Alert.Description>
												{t(
													"executableMcpWarningDescription",
												)}
											</Alert.Description>
										</Alert.Content>
									</Alert>
								)}
								<Card>
									<Card.Header>
										<div>
											<p className="text-sm text-muted">
												{t("mcp")}
											</p>
											<h3 className="break-all text-base font-semibold">
												{intent.name}
											</h3>
										</div>
									</Card.Header>
									<Card.Content className="space-y-3 text-sm">
										<div className="flex items-center justify-between gap-3">
											<span className="text-muted">
												{t("type")}
											</span>
											<span>
												{transportLabel(
													intent.transport,
												)}
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
										<div className="space-y-2">
											{intent.transport.type ===
											"stdio" ? (
												<>
													<TransportReviewField
														label={t("command")}
														value={
															intent.transport
																.command
														}
													/>
													<TransportReviewField
														label={t("args")}
														value={formatReviewValue(
															intent.transport
																.args,
														)}
													/>
													<TransportReviewField
														label={t("env")}
														value={
															hasMapEntries(
																intent.transport
																	.env,
															)
																? formatReviewValue(
																		intent
																			.transport
																			.env,
																	)
																: t("noEnvVars")
														}
													/>
												</>
											) : (
												<>
													<TransportReviewField
														label={t("url")}
														value={
															intent.transport.url
														}
													/>
													<TransportReviewField
														label={t("headers")}
														value={
															hasMapEntries(
																intent.transport
																	.headers,
															)
																? formatReviewValue(
																		intent
																			.transport
																			.headers,
																	)
																: t("noHeaders")
														}
													/>
												</>
											)}
											{intent.timeout !== undefined && (
												<TransportReviewField
													label={t("timeout")}
													value={t("timeoutSeconds", {
														seconds: intent.timeout,
													})}
												/>
											)}
										</div>
									</Card.Content>
								</Card>
								{requiresExecutableConsent &&
									results.length === 0 && (
										<label className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
											<input
												type="checkbox"
												checked={hasExecutableConsent}
												onChange={(event) =>
													setHasExecutableConsent(
														event.currentTarget
															.checked,
													)
												}
											/>
											<span>
												{t("confirmExecutableMcp")}
											</span>
										</label>
									)}
							</div>
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
										(requiresExecutableConsent &&
											!hasExecutableConsent) ||
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

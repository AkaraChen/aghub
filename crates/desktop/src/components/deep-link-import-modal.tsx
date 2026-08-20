import { Alert, Button, Card, Checkbox, Modal, Spinner } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InstallSkillRequest, TransportDto } from "../generated/dto";
import { auditDisposition } from "../hooks/audited-mutation";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useAuditedMutation } from "../hooks/use-audited-mutation";
import { useInstallTarget } from "../hooks/use-install-target";
import { useSkillAuditPreference } from "../hooks/use-skill-audit-preference";
import {
	supportsIndividualSkillTarget,
	supportsMcp,
} from "../lib/agent-capabilities";
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
import { SkillAudit } from "./skill-audit";
import { SkillInfoCard } from "./skill-info-card";
import { SkillTargetSelector } from "./skill-target-selector";

interface DeepLinkImportModalProps {
	intent: DeepLinkImportIntent | null;
	onComplete: () => void;
}

interface McpInstallVariables {
	intent: Extract<DeepLinkImportIntent, { kind: "mcp-config-install" }>;
	selectedAgents: Set<string>;
	installToProject: boolean;
	selectedProject: { id: string; path: string } | null;
}

interface SkillMarketCandidate {
	readonly source: string;
	readonly name: string;
	readonly agents: readonly string[];
	readonly scope: "global" | "project";
	readonly projectPath: string | null;
	readonly pendingResults: readonly InstallResult[];
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
	const { skillAuditEnabled, skillAuditReady } = useSkillAuditPreference();
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

	const [selectedAgentOverride, setSelectedAgentOverride] =
		useState<Set<string> | null>(null);
	const [hasExecutableConsent, setHasExecutableConsent] = useState(false);

	const compatibleAgents = useMemo(() => {
		if (!intent) {
			return [];
		}

		if (intent.kind === "skill-market-install") {
			return availableAgents.filter(
				(agent) =>
					agent.isUsable &&
					supportsIndividualSkillTarget(
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
		if (intent?.kind === "skill-market-install") {
			return new Set(["universal"]);
		}
		return compatibleAgents[0]
			? new Set([compatibleAgents[0].id])
			: new Set();
	}, [compatibleAgents, intent]);

	const selectedAgents = selectedAgentOverride ?? defaultSelectedAgents;

	const mcpInstallMutation = useMutation<
		InstallResult[],
		Error,
		McpInstallVariables
	>({
		mutationFn: async (variables: McpInstallVariables) => {
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

			return buildPendingResults(
				variables.selectedAgents,
				compatibleAgents,
			).map((result) => ({ ...result, status: "success" as const }));
		},
		onSuccess: (_results, variables) => {
			queryClient.invalidateQueries({ queryKey: queryKeys.mcps.all() });
			capture("deep link imported", {
				import_kind: "mcp",
				agents: Array.from(variables.selectedAgents),
				scope: variables.installToProject ? "project" : "global",
			});
		},
	});

	const isSkillInstall = intent?.kind === "skill-market-install";

	const createSkillCandidate = (
		skillIntent: Extract<
			DeepLinkImportIntent,
			{ kind: "skill-market-install" }
		>,
	): SkillMarketCandidate => ({
		source: skillIntent.source,
		name: skillIntent.name,
		agents: Array.from(selectedAgents),
		scope: installToProject ? "project" : "global",
		projectPath: selectedProject?.path ?? null,
		pendingResults: buildPendingResults(
			selectedAgents,
			compatibleAgents,
			t("universalAgentTarget"),
		),
	});

	const buildSkillRequest = (
		candidate: SkillMarketCandidate,
		overrides: Partial<InstallSkillRequest>,
	): InstallSkillRequest => ({
		source: candidate.source,
		agents: [...candidate.agents],
		skills: [candidate.name],
		scope: candidate.scope,
		project_path: candidate.projectPath,
		install_all: false,
		expected_content_digest: null,
		confirmed_assessment_digest: null,
		session_id: null,
		audit_only: false,
		...overrides,
	});

	const skillInstall = useAuditedMutation<
		SkillMarketCandidate,
		InstallResult[]
	>({
		audit: async (candidate, signal) => {
			const response = await api.skills.install(
				buildSkillRequest(candidate, { audit_only: true }),
				signal,
			);
			if (!response.audit) throw new Error(t("auditFailed"));
			return auditDisposition(
				response.audit,
				response.session_id ?? null,
				response.audit_confirmation_required,
			);
		},
		write: async (
			{ candidate, report, sessionId, confirmedAssessmentDigest },
			signal,
		) => {
			const response = await api.skills.install(
				buildSkillRequest(candidate, {
					expected_content_digest: report?.content_digest ?? null,
					confirmed_assessment_digest: confirmedAssessmentDigest,
					session_id: sessionId,
					audit_only: false,
				}),
				signal,
			);
			if (
				!response.success &&
				response.audit_confirmation_required &&
				response.audit
			) {
				const disposition = auditDisposition(
					response.audit,
					response.session_id ?? null,
					response.audit_confirmation_required,
				);
				if (disposition.kind !== "review") {
					throw new Error(t("auditFailed"));
				}
				return disposition;
			}
			if (response.success) {
				await queryClient.invalidateQueries({
					queryKey: queryKeys.skills.all(),
				});
				capture("deep link imported", {
					import_kind: "skill",
					agents: [...candidate.agents],
					scope: candidate.scope,
				});
			}
			return {
				kind: "done",
				result: candidate.pendingResults.map((result) => ({
					...result,
					status: response.success
						? ("success" as const)
						: ("error" as const),
					error: response.success
						? undefined
						: t("skillInstallFailed"),
				})),
				report:
					skillAuditEnabled || response.audit_confirmation_required
						? (response.audit ?? null)
						: report,
				sessionId: response.session_id ?? sessionId,
			};
		},
	});

	const runSkillAudit = () => {
		if (
			!intent ||
			intent.kind !== "skill-market-install" ||
			!skillAuditReady
		) {
			return;
		}

		const candidate = createSkillCandidate(intent);
		if (!skillAuditEnabled) {
			skillInstall.start(candidate, {
				kind: "allow",
				report: null,
				sessionId: null,
			});
			return;
		}
		skillInstall.start(candidate);
	};

	const handleInstall = () => {
		if (!intent) {
			return;
		}
		if (intent.kind === "skill-market-install") {
			if (skillInstall.isBusy) return;
			runSkillAudit();
			return;
		}
		if (mcpInstallMutation.isPending || mcpInstallMutation.isSuccess) {
			return;
		}
		mcpInstallMutation.mutate({
			intent,
			selectedAgents,
			installToProject,
			selectedProject,
		});
	};

	const resetSkillState = () => {
		skillInstall.reset();
	};

	const handleConfirmSkillInstall = () => {
		skillInstall.confirm();
	};

	const handleClose = () => {
		if (!intent) {
			onComplete();
			return;
		}
		setSelectedAgentOverride(null);
		setHasExecutableConsent(false);
		mcpInstallMutation.reset();
		resetSkillState();
		resetInstallTarget();
		onComplete();
	};

	const handleModalOpenChange = (isOpen: boolean) => {
		if (!isOpen) {
			handleClose();
		} else if (isOpen && intent) {
			setSelectedAgentOverride(null);
			setHasExecutableConsent(false);
			mcpInstallMutation.reset();
			resetSkillState();
			resetInstallTarget();
		}
	};

	const skillPhase =
		skillInstall.state.tag === "idle"
			? "idle"
			: skillInstall.state.tag === "auditing"
				? "auditing"
				: skillInstall.state.tag === "review"
					? "review"
					: skillInstall.state.tag === "writing"
						? "installing"
						: skillInstall.state.tag === "failed" &&
							  skillInstall.state.stage === "audit"
							? "idle"
							: "done";
	const audit =
		skillInstall.state.tag === "review" ||
		skillInstall.state.tag === "writing" ||
		skillInstall.state.tag === "done"
			? skillInstall.state.report
			: null;
	const isInstalling = isSkillInstall
		? skillPhase === "installing"
		: mcpInstallMutation.isPending;
	const mcpResults = mcpInstallMutation.data ?? [];
	const skillFailure =
		skillInstall.state.tag === "failed" ? skillInstall.state : null;
	const results: InstallResult[] = isSkillInstall
		? skillInstall.state.tag === "done"
			? skillInstall.state.result
			: skillInstall.state.tag === "writing"
				? [...skillInstall.state.candidate.pendingResults]
				: skillFailure
					? skillFailure.candidate.pendingResults.map((result) => ({
							...result,
							status: "error",
							error: skillFailure.error.message,
						}))
					: []
		: mcpResults;
	const error =
		(isSkillInstall
			? skillFailure?.error.message
			: mcpInstallMutation.error?.message) ?? null;
	const requiresExecutableConsent =
		intent?.kind === "mcp-config-install" &&
		intent.transport.type === "stdio";
	const showAuditCard =
		isSkillInstall &&
		skillPhase !== "idle" &&
		(skillAuditEnabled || skillPhase === "review");
	const showInstallCard =
		isSkillInstall &&
		(skillPhase === "installing" || skillPhase === "done");
	const showPicker = isSkillInstall
		? skillPhase === "idle"
		: mcpResults.length === 0 && !mcpInstallMutation.isPending;

	return (
		<Modal.Backdrop
			isOpen={Boolean(intent)}
			isDismissable={!isInstalling}
			isKeyboardDismissDisabled={isInstalling}
			onOpenChange={handleModalOpenChange}
		>
			<Modal.Container>
				<Modal.Dialog className="max-w-md">
					<Modal.CloseTrigger isDisabled={isInstalling} />
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
									mcpResults.length === 0 && (
										<Checkbox
											variant="secondary"
											isSelected={hasExecutableConsent}
											onChange={setHasExecutableConsent}
										>
											<Checkbox.Content className="text-sm">
												<Checkbox.Control>
													<Checkbox.Indicator />
												</Checkbox.Control>
												{t("confirmExecutableMcp")}
											</Checkbox.Content>
										</Checkbox>
									)}
							</div>
						)}

						{showAuditCard && (
							<Card variant="secondary">
								<Card.Content className="space-y-3">
									<p className="text-sm font-medium text-foreground">
										{t("securityAudit")}
									</p>
									{skillPhase === "auditing" && !audit ? (
										<div className="flex items-center justify-center gap-3 py-6 text-sm text-muted">
											<Spinner size="sm" />
											{t("auditing")}
										</div>
									) : (
										audit && (
											<>
												{skillPhase === "review" && (
													<p className="text-sm text-danger">
														{t("auditBlockedHint")}
													</p>
												)}
												<SkillAudit
													report={audit}
													embedded
												/>
											</>
										)
									)}
								</Card.Content>
							</Card>
						)}

						{showInstallCard && (
							<Card variant="secondary">
								<Card.Content className="space-y-3">
									<p className="text-sm font-medium text-foreground">
										{skillPhase === "done"
											? t("installComplete")
											: t("installingSkills")}
									</p>
									{results.map((result) => (
										<ResultStatusItem
											key={result.agentId}
											displayName={result.displayName}
											status={result.status}
											statusText={
												result.status === "pending"
													? t("installing")
													: result.status ===
														  "success"
														? t("installSuccess")
														: ""
											}
											error={result.error}
										/>
									))}
								</Card.Content>
							</Card>
						)}

						{showPicker && (
							<div className="space-y-4">
								<p className="text-sm text-muted">
									{intent?.kind === "mcp-config-install"
										? t("selectAgentsForMcp")
										: t("selectAgentsForSkill")}
								</p>
								{isSkillInstall ? (
									<SkillTargetSelector
										agents={compatibleAgents}
										selectedKeys={selectedAgents}
										onSelectionChange={
											setSelectedAgentOverride
										}
										label={t("targetAgent")}
										showSelectedIcon
										variant="secondary"
									/>
								) : (
									<AgentSelector
										agents={compatibleAgents}
										selectedKeys={selectedAgents}
										onSelectionChange={
											setSelectedAgentOverride
										}
										label={t("targetAgent")}
										emptyMessage={t("noTargetAgents")}
										showSelectedIcon
										variant="secondary"
									/>
								)}
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

						{!isSkillInstall && mcpResults.length > 0 && (
							<div className="space-y-3">
								{mcpResults.map((result) => (
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
						{isSkillInstall ? (
							skillPhase === "review" ? (
								<>
									<Button slot="close" variant="secondary">
										{t("cancel")}
									</Button>
									<Button
										variant="danger"
										onPress={handleConfirmSkillInstall}
									>
										{t("installAnyway")}
									</Button>
								</>
							) : skillPhase === "auditing" ? (
								<>
									<Button slot="close" variant="secondary">
										{t("cancel")}
									</Button>
									<Button isDisabled>{t("auditing")}</Button>
								</>
							) : skillPhase === "installing" ? (
								<Button isDisabled>{t("installing")}</Button>
							) : skillPhase === "done" ? (
								<Button slot="close" variant="secondary">
									{t("done")}
								</Button>
							) : (
								<>
									<Button slot="close" variant="secondary">
										{t("cancel")}
									</Button>
									<Button
										onPress={handleInstall}
										isDisabled={
											selectedAgents.size === 0 ||
											!skillAuditReady ||
											(installToProject &&
												!selectedProject)
										}
									>
										{t("install")}
									</Button>
								</>
							)
						) : mcpResults.length === 0 ? (
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

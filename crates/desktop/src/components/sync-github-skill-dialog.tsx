import { BookOpenIcon, EyeIcon, XCircleIcon } from "@heroicons/react/24/solid";

const BACKSLASH_RE = /\\/g;

import {
	Alert,
	Button,
	Checkbox,
	Chip,
	Input,
	Label,
	ListBox,
	Modal,
	Select,
	Spinner,
	TextField,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GitScanRequest,
	GitScanResponse,
	GitScanSkillEntry,
} from "../generated/dto";
import { auditDisposition } from "../hooks/audited-mutation";
import { useApi } from "../hooks/use-api";
import { useAuditedMutation } from "../hooks/use-audited-mutation";
import { useAuditedSkillRun } from "../hooks/use-audited-skill-run";
import { useSkillAuditPreference } from "../hooks/use-skill-audit-preference";
import { CreateCredentialDialog } from "../pages/settings/components/create-credential-dialog";
import { credentialsListQueryOptions } from "../requests/credentials";
import { invalidateSkillQueries } from "../requests/skills";
import { SkillAudit } from "./skill-audit";
import type { SkillGroup } from "./skill-detail-helpers";

interface SyncGithubSkillDialogProps {
	group: SkillGroup;
	sourceUrl: string;
	/** Relative path of the skill inside the source repo, if known. */
	skillPath: string | null;
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

interface SyncCandidate {
	readonly sessionId: string;
	readonly skillPath: string;
	readonly sourcePaths: string[];
	readonly scope: "global" | "all";
	readonly projectRoot: string | null;
	readonly sourceUrl: string;
	readonly credentialId: string | null;
	readonly branch: string;
}

const ADD_TOKEN_SENTINEL = "__add_token__";

export function SyncGithubSkillDialog({
	group,
	sourceUrl,
	skillPath,
	isOpen,
	onClose,
	projectPath,
}: SyncGithubSkillDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { skillAuditEnabled, skillAuditReady } = useSkillAuditPreference();
	const { beginAuditedSkillRun, invalidateAuditedSkillRun } =
		useAuditedSkillRun();

	const [basePhase, setBasePhase] = useState<"idle" | "scanning" | "scanned">(
		"idle",
	);
	const [isPrivateRepo, setIsPrivateRepo] = useState(false);
	const [credentialId, setCredentialId] = useState<string>("");
	const [isAddTokenOpen, setIsAddTokenOpen] = useState(false);
	const [sessionId, setSessionId] = useState<string>("");
	const [branches, setBranches] = useState<string[]>([]);
	const [currentBranch, setCurrentBranch] = useState<string>("");
	const [scannedSkills, setScannedSkills] = useState<GitScanSkillEntry[]>([]);
	const [scanError, setScanError] = useState<string | null>(null);
	const [syncError, setSyncError] = useState<string | null>(null);
	const [previewSkill, setPreviewSkill] = useState<GitScanSkillEntry | null>(
		null,
	);

	const { data: credentials = [] } = useQuery({
		...credentialsListQueryOptions({
			api,
			enabled: isOpen && isPrivateRepo,
		}),
	});

	// Match the current skill in the scanned results by the known skillPath.
	// Falls back to matching by skill name.
	const normalizedSkillPath = skillPath
		? skillPath.replace(BACKSLASH_RE, "/")
		: null;
	const matchedSkill =
		scannedSkills.find((s) => {
			if (normalizedSkillPath) {
				const normPath = s.path.replace(BACKSLASH_RE, "/");
				return (
					normPath === normalizedSkillPath ||
					normPath.startsWith(`${normalizedSkillPath}/`) ||
					normalizedSkillPath.startsWith(`${normPath}/`)
				);
			}
			return s.name === group.items[0].name;
		}) ?? null;

	// All filesystem paths that need to be replaced on sync.
	const sourcePaths = group.items
		.map((item) => item.source_path)
		.filter((p): p is string => Boolean(p));
	const syncScope =
		projectPath && group.items.some((item) => item.source === "project")
			? "all"
			: "global";

	const scanMutation = useMutation({
		mutationFn: (request: GitScanRequest) => api.skills.gitScan(request),
	});

	const syncMutation = useAuditedMutation<SyncCandidate, true>({
		recover: async (candidate, error, signal) => {
			if (error.kind !== "session_expired") return candidate;
			const scan = await api.skills.gitScan(
				{
					url: candidate.sourceUrl,
					credential_id: candidate.credentialId,
					branch: candidate.branch,
					session_id: null,
					skip_audit: true,
				},
				signal,
			);
			setSessionId(scan.session_id);
			return { ...candidate, sessionId: scan.session_id };
		},
		audit: async (candidate, signal) => {
			const response = await api.skills.gitSync(
				{
					session_id: candidate.sessionId,
					skill_path: candidate.skillPath,
					source_paths: candidate.sourcePaths,
					scope: candidate.scope,
					project_root: candidate.projectRoot,
					expected_content_digest: null,
					confirmed_assessment_digest: null,
					audit_only: true,
				},
				signal,
			);
			if (!response.audit) throw new Error(t("auditFailed"));
			return auditDisposition(
				response.audit,
				candidate.sessionId,
				response.audit_confirmation_required,
			);
		},
		write: async (
			{ candidate, report, confirmedAssessmentDigest },
			signal,
		) => {
			const response = await api.skills.gitSync(
				{
					session_id: candidate.sessionId,
					skill_path: candidate.skillPath,
					source_paths: candidate.sourcePaths,
					scope: candidate.scope,
					project_root: candidate.projectRoot,
					expected_content_digest: report?.content_digest ?? null,
					confirmed_assessment_digest: confirmedAssessmentDigest,
					audit_only: false,
				},
				signal,
			);
			if (
				!response.success &&
				response.audit_confirmation_required &&
				response.audit
			) {
				const disposition = auditDisposition(
					response.audit,
					candidate.sessionId,
					response.audit_confirmation_required,
				);
				if (disposition.kind !== "review") {
					throw new Error(t("auditFailed"));
				}
				return disposition;
			}
			if (!response.success) {
				throw new Error(
					response.audit?.summary ??
						response.error ??
						t("unknownError"),
				);
			}
			await invalidateSkillQueries(queryClient);
			setBasePhase("idle");
			toast.success(t("skillSyncedSuccessfully"));
			onClose();
			return {
				kind: "done",
				result: true,
				report: response.audit ?? report,
				sessionId: candidate.sessionId,
			};
		},
	});

	const phase =
		syncMutation.state.tag === "auditing"
			? "auditing"
			: syncMutation.state.tag === "review"
				? "review"
				: syncMutation.state.tag === "writing"
					? "syncing"
					: basePhase;
	const auditReport =
		syncMutation.state.tag === "review" ||
		syncMutation.state.tag === "writing"
			? syncMutation.state.report
			: null;
	const mutationError =
		syncMutation.state.tag === "failed"
			? syncMutation.state.error.message
			: null;

	const applyScanResult = (data: GitScanResponse) => {
		setScanError(null);
		setSessionId(data.session_id);
		setBranches(data.branches);
		setCurrentBranch(data.current_branch);
		setScannedSkills(data.skills);
		syncMutation.reset();
		setBasePhase("scanned");
	};

	const scan = async (branch: string | null) => {
		if (!skillAuditReady) return;
		const run = beginAuditedSkillRun(branch);
		setScanError(null);
		setSyncError(null);
		syncMutation.reset();
		if (!branch) setBasePhase("scanning");
		try {
			const data = await scanMutation.mutateAsync({
				url: sourceUrl,
				credential_id: credentialId || null,
				branch,
				session_id: branch ? sessionId : null,
				skip_audit: !skillAuditEnabled,
			});
			if (!run.isCurrent()) return;
			applyScanResult(data);
		} catch (error) {
			if (!run.isCurrent()) return;
			setScanError(
				error instanceof Error ? error.message : String(error),
			);
			if (!branch) setBasePhase("idle");
		}
	};

	const handleScan = () => void scan(null);

	const handleBranchChange = (branch: string) => {
		if (phase !== "scanned" || branch === currentBranch) return;
		void scan(branch);
	};

	const handleSync = async () => {
		if (!matchedSkill || !skillAuditReady) return;
		setSyncError(null);
		const candidate: SyncCandidate = {
			sessionId,
			skillPath: matchedSkill.path,
			sourcePaths,
			scope: syncScope,
			projectRoot: projectPath ?? null,
			sourceUrl,
			credentialId: credentialId || null,
			branch: currentBranch,
		};
		if (skillAuditEnabled) {
			await syncMutation.start(candidate);
			return;
		}
		await syncMutation.start(candidate, {
			kind: "allow",
			report: null,
			sessionId,
		});
	};

	const handleClose = () => {
		if (phase === "auditing" || phase === "syncing") return;
		invalidateAuditedSkillRun();
		syncMutation.reset();
		setBasePhase("idle");
		setIsPrivateRepo(false);
		setCredentialId("");
		setSessionId("");
		setBranches([]);
		setCurrentBranch("");
		setScannedSkills([]);
		setScanError(null);
		setSyncError(null);
		onClose();
	};

	const isBranchSwitching = scanMutation.isPending && phase === "scanned";
	const isSyncing = phase === "auditing" || phase === "syncing";
	const visibleSyncError = mutationError ?? syncError;

	return (
		<>
			<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
				<Modal.Container>
					<Modal.Dialog className="w-[calc(100vw-2rem)] max-w-lg">
						<Modal.CloseTrigger isDisabled={isSyncing} />
						<Modal.Header>
							<Modal.Heading>{t("syncSkill")}</Modal.Heading>
						</Modal.Header>

						<Modal.Body className="space-y-4 p-4">
							{/* ── Source URL (read-only display) ── */}
							<TextField className="w-full" isReadOnly>
								<Label>{t("githubRepoUrl")}</Label>
								<Input
									value={sourceUrl}
									variant="secondary"
									className="font-mono text-sm"
								/>
							</TextField>

							{/* ── Private repo toggle ── */}
							<Checkbox
								variant="secondary"
								isSelected={isPrivateRepo}
								isDisabled={phase !== "idle"}
								onChange={(checked) => {
									setIsPrivateRepo(checked);
									if (!checked) setCredentialId("");
								}}
							>
								<Checkbox.Content>
									<Checkbox.Control>
										<Checkbox.Indicator />
									</Checkbox.Control>
									<Label>{t("privateRepo")}</Label>
								</Checkbox.Content>
							</Checkbox>

							{/* ── Credential selector (shown when private) ── */}
							{isPrivateRepo && (
								<Select
									className="w-full"
									variant="secondary"
									selectedKey={credentialId || undefined}
									isDisabled={phase !== "idle"}
									onSelectionChange={(key) => {
										if (key === ADD_TOKEN_SENTINEL) {
											setIsAddTokenOpen(true);
											return;
										}
										setCredentialId(String(key));
									}}
								>
									<Label>{t("selectCredential")}</Label>
									<Select.Trigger>
										<Select.Value />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											{credentials.map((cred) => (
												<ListBox.Item
													key={cred.id}
													id={cred.id}
													textValue={cred.name}
												>
													{cred.name}
													<ListBox.ItemIndicator />
												</ListBox.Item>
											))}
											<ListBox.Section className="mt-1 border-t border-border pt-1">
												<ListBox.Item
													id={ADD_TOKEN_SENTINEL}
													textValue={t("addToken")}
												>
													{t("addToken")}
												</ListBox.Item>
											</ListBox.Section>
										</ListBox>
									</Select.Popover>
								</Select>
							)}

							{/* ── Scan error ── */}
							{scanError && (
								<Alert status="danger">
									<Alert.Indicator />
									<Alert.Content>
										<Alert.Description>
											{scanError}
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}

							{visibleSyncError && (
								<Alert role="alert" status="danger">
									<Alert.Indicator />
									<Alert.Content>
										<Alert.Description>
											{visibleSyncError}
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}

							{/* ── Branch selector (post-scan) ── */}
							{phase !== "idle" &&
								phase !== "scanning" &&
								branches.length > 0 && (
									<Select
										className="w-full"
										variant="secondary"
										selectedKey={currentBranch}
										isDisabled={
											phase !== "scanned" ||
											isBranchSwitching
										}
										onSelectionChange={(key) =>
											handleBranchChange(String(key))
										}
									>
										<Label>{t("branch")}</Label>
										<Select.Trigger>
											{isBranchSwitching ? (
												<span className="flex items-center gap-2">
													<Spinner
														size="sm"
														color="current"
													/>
													{t("switchingBranch")}
												</span>
											) : (
												<Select.Value />
											)}
											<Select.Indicator />
										</Select.Trigger>
										<Select.Popover>
											<ListBox>
												{branches.map((branch) => (
													<ListBox.Item
														key={branch}
														id={branch}
														textValue={branch}
													>
														{branch}
														<ListBox.ItemIndicator />
													</ListBox.Item>
												))}
											</ListBox>
										</Select.Popover>
									</Select>
								)}

							{(phase === "scanned" ||
								phase === "review" ||
								isSyncing) && (
								<>
									{matchedSkill ? (
										<div>
											<p className="mb-2 text-xs font-medium text-muted uppercase tracking-wide">
												{t("skillFoundInRepo")}
											</p>
											<button
												type="button"
												onClick={() =>
													setPreviewSkill(
														matchedSkill,
													)
												}
												className="flex w-full items-start gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-left transition-colors hover:bg-accent/10"
											>
												<BookOpenIcon className="mt-0.5 size-4 shrink-0 text-accent" />
												<div className="min-w-0 flex-1">
													<div className="flex flex-wrap items-center gap-2">
														<span className="font-medium text-foreground">
															{matchedSkill.name}
														</span>
														{matchedSkill.version && (
															<Chip
																size="sm"
																variant="secondary"
															>
																v
																{
																	matchedSkill.version
																}
															</Chip>
														)}
														{matchedSkill.author && (
															<Chip
																size="sm"
																variant="secondary"
															>
																{
																	matchedSkill.author
																}
															</Chip>
														)}
													</div>
													{matchedSkill.description && (
														<p className="mt-1 text-sm text-muted">
															{
																matchedSkill.description
															}
														</p>
													)}
												</div>
												<EyeIcon className="mt-0.5 size-4 shrink-0 text-muted" />
											</button>
										</div>
									) : (
										<div className="flex items-center gap-2 rounded-lg border border-border p-3">
											<XCircleIcon className="size-4 shrink-0 text-warning" />
											<p className="text-sm text-muted">
												{t("skillNotFoundInRepo")}
											</p>
										</div>
									)}
								</>
							)}

							{auditReport && (
								<div className="space-y-3">
									{phase === "review" && (
										<p className="text-sm text-danger">
											{t("auditSyncBlockedHint")}
										</p>
									)}
									<SkillAudit report={auditReport} />
								</div>
							)}

							{/* ── Scanning spinner ── */}
							{phase === "scanning" && (
								<div className="flex items-center justify-center gap-3 py-4">
									<Spinner size="md" />
									<p className="text-sm text-muted">
										{t("scanningRepo")}
									</p>
								</div>
							)}
						</Modal.Body>

						<Modal.Footer>
							<Button
								variant="secondary"
								onPress={handleClose}
								isDisabled={isSyncing}
							>
								{t("cancel")}
							</Button>

							{phase === "idle" ? (
								<Button
									onPress={handleScan}
									isDisabled={
										!skillAuditReady ||
										scanMutation.isPending ||
										(isPrivateRepo && !credentialId)
									}
								>
									{t("scanRepo")}
								</Button>
							) : phase === "auditing" ? (
								<Button isDisabled>{t("auditing")}</Button>
							) : phase === "review" ? (
								<Button
									variant="danger"
									onPress={() => void syncMutation.confirm()}
								>
									{t("syncAnyway")}
								</Button>
							) : (
								<Button
									onPress={() => void handleSync()}
									isDisabled={
										!matchedSkill ||
										!skillAuditReady ||
										isSyncing ||
										isBranchSwitching
									}
								>
									{isSyncing ? (
										<span className="flex items-center gap-2">
											<Spinner
												size="sm"
												color="current"
											/>
											{t("syncingSkill")}
										</span>
									) : (
										t("confirm")
									)}
								</Button>
							)}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>

			{/* ── Skill Preview Modal ── */}
			<Modal.Backdrop
				isOpen={previewSkill !== null}
				onOpenChange={(open) => {
					if (!open) setPreviewSkill(null);
				}}
			>
				<Modal.Container>
					<Modal.Dialog className="w-[calc(100vw-2rem)] max-w-md">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>
								{previewSkill?.name ?? ""}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="space-y-3 p-4">
							{previewSkill?.description && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">
										{t("description")}
									</p>
									<p className="text-sm text-foreground">
										{previewSkill.description}
									</p>
								</div>
							)}
							{previewSkill?.version && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">
										{t("version")}
									</p>
									<p className="text-sm text-foreground">
										{previewSkill.version}
									</p>
								</div>
							)}
							{previewSkill?.author && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">
										{t("author")}
									</p>
									<p className="text-sm text-foreground">
										{previewSkill.author}
									</p>
								</div>
							)}
							{previewSkill?.path && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">
										{t("source")}
									</p>
									<p className="break-all font-mono text-xs text-muted">
										{previewSkill.path}
									</p>
								</div>
							)}
						</Modal.Body>
						<Modal.Footer>
							<Button
								variant="secondary"
								onPress={() => setPreviewSkill(null)}
							>
								{t("cancel")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>

			<CreateCredentialDialog
				isOpen={isAddTokenOpen}
				onClose={() => setIsAddTokenOpen(false)}
				onSuccess={(newId) => {
					if (newId) setCredentialId(newId);
				}}
			/>
		</>
	);
}

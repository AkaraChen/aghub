import {
	BookOpenIcon,
	CheckCircleIcon,
	ChevronDownIcon,
	EyeIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import {
	Alert,
	Button,
	Card,
	Checkbox,
	Chip,
	FieldError,
	Fieldset,
	Form,
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
import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type {
	GitInstallResultEntry,
	GitScanSkillEntry,
} from "../generated/dto";
import { auditDisposition } from "../hooks/audited-mutation";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useAuditedMutation } from "../hooks/use-audited-mutation";
import { useSkillAuditPreference } from "../hooks/use-skill-audit-preference";
import {
	type AuditedSkillRun,
	useAuditedSkillRun,
} from "../hooks/use-audited-skill-run";
import { supportsIndividualSkillTarget } from "../lib/agent-capabilities";
import { cn } from "../lib/utils";
import { CreateCredentialDialog } from "../pages/settings/components/create-credential-dialog";
import { credentialsListQueryOptions } from "../requests/credentials";
import { invalidateSkillQueries } from "../requests/skills";
import { SkillAudit } from "./skill-audit";
import { SkillTargetSelector } from "./skill-target-selector";

interface ImportGithubSkillPanelProps {
	onDone: () => void;
	projectPath?: string;
	/** Pre-fills the repository URL — used by a library's "update from
	 * source", which re-imports from the same repo. */
	initialUrl?: string;
}

const ADD_TOKEN_SENTINEL = "__add_token__";

interface InputFormValues {
	url: string;
	credentialId: string;
	selectedAgents: string[];
}

interface GitInstallCandidate {
	readonly sessionId: string;
	readonly url: string;
	readonly credentialId: string | null;
	readonly branch: string;
	readonly skillPaths: readonly string[];
	readonly agents: readonly string[];
	readonly scope: "global" | "project";
	readonly projectRoot: string | null;
}

interface GitBranchScanCandidate {
	readonly branch: string;
	readonly sessionId: string;
	readonly url: string;
}

type Phase =
	"scanning" | "selecting" | "auditing" | "review" | "installing" | "done";

// Which cards have been reached at least once for a given phase
function cardReached(card: 1 | 2 | 3 | 4, phase: Phase): boolean {
	const order: Phase[] = [
		"scanning",
		"selecting",
		"auditing",
		"review",
		"installing",
		"done",
	];
	const thresholds: Record<1 | 2 | 3 | 4, Phase> = {
		1: "scanning",
		2: "selecting",
		3: "auditing",
		4: "installing",
	};
	return order.indexOf(phase) >= order.indexOf(thresholds[card]);
}

export function ImportGithubSkillPanel({
	onDone,
	projectPath,
	initialUrl,
}: ImportGithubSkillPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const { skillAuditEnabled, skillAuditReady } = useSkillAuditPreference();
	const { beginAuditedSkillRun, invalidateAuditedSkillRun } =
		useAuditedSkillRun();

	const skillAgents = useMemo(
		() =>
			availableAgents.filter(
				(a) =>
					a.isUsable &&
					supportsIndividualSkillTarget(
						a,
						projectPath ? "project" : "global",
					),
			),
		[availableAgents, projectPath],
	);

	const [basePhase, setBasePhase] = useState<Phase>("scanning");
	const [card1Open, setCard1Open] = useState(true);
	const [card2Open, setCard2Open] = useState(false);
	const [card3Open, setCard3Open] = useState(false);
	const [card4Open, setCard4Open] = useState(false);
	const [isPrivateRepo, setIsPrivateRepo] = useState(false);
	const [isAddTokenOpen, setIsAddTokenOpen] = useState(false);
	const [scannedSkills, setScannedSkills] = useState<GitScanSkillEntry[]>([]);
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
		() => new Set(),
	);
	const [sessionId, setSessionId] = useState<string>("");
	const [branches, setBranches] = useState<string[]>([]);
	const [currentBranch, setCurrentBranch] = useState<string>("");
	const [scanError, setScanError] = useState<string | null>(null);
	const [previewSkill, setPreviewSkill] = useState<GitScanSkillEntry | null>(
		null,
	);

	const { data: credentials = [] } = useQuery({
		...credentialsListQueryOptions({ api, enabled: isPrivateRepo }),
	});

	const {
		control,
		handleSubmit,
		reset,
		setValue,
		formState: { isSubmitting },
	} = useForm<InputFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			url: initialUrl ?? "",
			credentialId: "",
			selectedAgents: ["universal"],
		},
	});

	const urlValue = useWatch({ control, name: "url" });
	const credentialIdValue = useWatch({ control, name: "credentialId" });

	const buildInstallBase = (candidate: GitInstallCandidate) => ({
		session_id: candidate.sessionId,
		skill_paths: [...candidate.skillPaths],
		agents: [...candidate.agents],
		scope: candidate.scope,
		project_root: candidate.projectRoot,
	});

	const gitInstall = useAuditedMutation<
		GitInstallCandidate,
		GitInstallResultEntry[]
	>({
		recover: async (candidate, error, signal) => {
			if (error.kind !== "session_expired") return candidate;
			const scan = await api.skills.gitScan(
				{
					url: candidate.url,
					credential_id: candidate.credentialId,
					branch: candidate.branch,
					session_id: null,
					skip_audit: true,
				},
				signal,
			);
			return { ...candidate, sessionId: scan.session_id };
		},
		audit: async (candidate, signal) => {
			const response = await api.skills.gitInstall(
				{
					...buildInstallBase(candidate),
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
			setCard4Open(true);
			const response = await api.skills.gitInstall(
				{
					...buildInstallBase(candidate),
					expected_content_digest: report?.content_digest ?? null,
					confirmed_assessment_digest: confirmedAssessmentDigest,
					audit_only: false,
				},
				signal,
			);
			if (
				response.results.length === 0 &&
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
			await invalidateSkillQueries(queryClient);
			return {
				kind: "done",
				result: response.results,
				report:
					skillAuditEnabled || response.audit_confirmation_required
						? (response.audit ?? null)
						: report,
				sessionId: candidate.sessionId,
			};
		},
	});

	const phase: Phase =
		gitInstall.state.tag === "idle"
			? basePhase
			: gitInstall.state.tag === "auditing"
				? "auditing"
				: gitInstall.state.tag === "review"
					? "review"
					: gitInstall.state.tag === "writing"
						? "installing"
						: gitInstall.state.tag === "done"
							? "done"
							: "selecting";
	const auditReport =
		gitInstall.state.tag === "review" ||
		gitInstall.state.tag === "writing" ||
		gitInstall.state.tag === "done"
			? gitInstall.state.report
			: null;
	const installResults =
		gitInstall.state.tag === "done" ? gitInstall.state.result : [];
	const installError =
		gitInstall.state.tag === "failed"
			? gitInstall.state.error.message
			: null;
	const visibleCard2Open =
		gitInstall.state.tag === "review"
			? false
			: gitInstall.state.tag === "failed"
				? true
				: card2Open;
	const visibleCard3Open =
		gitInstall.state.tag === "review"
			? true
			: gitInstall.state.tag === "failed"
				? false
				: card3Open;
	const visibleCard4Open =
		gitInstall.state.tag === "writing"
			? true
			: gitInstall.state.tag === "auditing" ||
				  gitInstall.state.tag === "review" ||
				  gitInstall.state.tag === "failed"
				? false
				: card4Open;

	const scanMutation = useMutation({
		mutationFn: (run: AuditedSkillRun<InputFormValues>) =>
			api.skills.gitScan({
				url: run.candidate.url.trim(),
				credential_id: run.candidate.credentialId || null,
				branch: null,
				session_id: null,
				skip_audit: !skillAuditEnabled,
			}),
		onSuccess: (data, run) => {
			if (!run.isCurrent()) return;
			setScanError(null);
			gitInstall.reset();
			setScannedSkills(data.skills);
			setSessionId(data.session_id);
			setBranches(data.branches);
			setCurrentBranch(data.current_branch);
			setSelectedPaths(new Set(data.skills.map((s) => s.path)));
			setCard1Open(false);
			setCard2Open(true);
			setBasePhase("selecting");
		},
		onError: (error, run) => {
			if (!run.isCurrent()) return;
			const message =
				error instanceof Error ? error.message : String(error);
			setScanError(message);
			toast.danger(t("scanFailed"), {
				description: t("scanFailedHint"),
			});
		},
	});

	const branchScanMutation = useMutation({
		mutationFn: (run: AuditedSkillRun<GitBranchScanCandidate>) =>
			api.skills.gitScan({
				url: run.candidate.url,
				credential_id: null,
				branch: run.candidate.branch,
				session_id: run.candidate.sessionId,
				skip_audit: !skillAuditEnabled,
			}),
		onSuccess: (data, run) => {
			if (!run.isCurrent()) return;
			gitInstall.reset();
			setScannedSkills(data.skills);
			setSessionId(data.session_id);
			setCurrentBranch(data.current_branch);
			setSelectedPaths(new Set(data.skills.map((s) => s.path)));
			setCard2Open(true);
			setCard3Open(false);
			setCard4Open(false);
			setBasePhase("selecting");
		},
		onError: (error, run) => {
			if (!run.isCurrent()) return;
			const message =
				error instanceof Error ? error.message : String(error);
			toast.danger(t("scanFailed"), {
				description: message,
			});
		},
	});

	const handleScan = (values: InputFormValues) => {
		if (!skillAuditReady) return;
		setScanError(null);
		const run = beginAuditedSkillRun({
			...values,
			selectedAgents: [...values.selectedAgents],
		});
		scanMutation.mutate(run);
	};

	const handleBranchScan = (branch: string) => {
		if (
			!skillAuditReady ||
			phase !== "selecting" ||
			branch === currentBranch
		) {
			return;
		}
		dropAuditReview();
		setCard2Open(true);
		setCard3Open(false);
		setCard4Open(false);
		setBasePhase("selecting");
		const run = beginAuditedSkillRun<GitBranchScanCandidate>({
			branch,
			sessionId,
			url: urlValue.trim(),
		});
		branchScanMutation.mutate(run);
	};

	const createInstallCandidate = (agents: string[]): GitInstallCandidate => ({
		sessionId,
		url: urlValue.trim(),
		credentialId: credentialIdValue || null,
		branch: currentBranch,
		skillPaths: Array.from(selectedPaths).sort(),
		agents: [...agents],
		scope: projectPath ? "project" : "global",
		projectRoot: projectPath ?? null,
	});

	const handleInstall = (agents: string[]) => {
		if (!sessionId || !skillAuditReady) return;
		const candidate = createInstallCandidate(agents);
		setCard2Open(false);
		setCard4Open(false);
		if (!skillAuditEnabled) {
			setCard3Open(false);
			gitInstall.start(candidate, {
				kind: "allow",
				report: null,
				sessionId: candidate.sessionId,
			});
			return;
		}
		setCard3Open(true);
		gitInstall.start(candidate);
	};

	const handleConfirmInstall = () => {
		setCard4Open(true);
		gitInstall.confirm();
	};

	function dropAuditReview() {
		invalidateAuditedSkillRun();
		gitInstall.reset();
	}

	const handleDone = () => {
		if (phase === "installing") return;
		dropAuditReview();
		onDone();
	};

	const handleImportAnother = () => {
		if (phase === "installing") return;
		dropAuditReview();
		reset();
		setIsPrivateRepo(false);
		setScannedSkills([]);
		setSelectedPaths(new Set());
		setSessionId("");
		setBranches([]);
		setCurrentBranch("");
		setScanError(null);
		setCard1Open(true);
		setCard2Open(false);
		setCard3Open(false);
		setCard4Open(false);
		setBasePhase("scanning");
		scanMutation.reset();
		branchScanMutation.reset();
	};

	// Card 1 toggle: re-opening resets everything back to scanning
	const handleCard1Toggle = () => {
		if (phase === "installing") return;
		if (!card1Open) {
			dropAuditReview();
			// Reset all downstream state
			setScannedSkills([]);
			setSelectedPaths(new Set());
			setSessionId("");
			setBranches([]);
			setCurrentBranch("");
			setScanError(null);
			setCard2Open(false);
			setCard3Open(false);
			setCard4Open(false);
			setBasePhase("scanning");
			scanMutation.reset();
			branchScanMutation.reset();
		}
		setCard1Open((v) => !v);
	};

	// Card 2 toggle: only when it has been reached
	const handleCard2Toggle = () => {
		if (!cardReached(2, phase)) return;
		setCard2Open((v) => !v);
	};

	// Card 3 toggle: only when it has been reached
	const handleCard3Toggle = () => {
		if (!cardReached(3, phase)) return;
		setCard3Open((v) => !v);
	};

	const handleCard4Toggle = () => {
		if (!cardReached(4, phase)) return;
		setCard4Open((v) => !v);
	};

	const togglePath = (path: string) => {
		dropAuditReview();
		setSelectedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const selectAll = () => {
		dropAuditReview();
		setSelectedPaths(new Set(scannedSkills.map((s) => s.path)));
	};
	const deselectAll = () => {
		dropAuditReview();
		setSelectedPaths(new Set());
	};

	const successCount = installResults.filter((r) => r.success).length;
	const failCount = installResults.filter((r) => !r.success).length;

	const card1Active = phase === "scanning";
	const card2Active = phase === "selecting";
	const showAuditStep = skillAuditEnabled || phase === "review";
	const card3Active =
		(skillAuditEnabled && phase === "auditing") || phase === "review";
	const card4Active = phase === "installing" || phase === "done";
	const isBranchSwitching = branchScanMutation.isPending;

	const card2Reached = cardReached(2, phase);
	const card3Reached = showAuditStep && cardReached(3, phase);
	const card4Reached = cardReached(4, phase);

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			<div className="space-y-3">
				<div className="mb-5">
					<h1 className="text-xl font-semibold text-foreground">
						{t("importFromGitRepository")}
					</h1>
				</div>

				<Card
					className={cn(
						!card1Active && "opacity-60",
						!card1Open && "!pb-0",
					)}
				>
					<button
						type="button"
						className={cn(
							"flex w-full items-center justify-between text-left",
							phase === "installing" && "cursor-not-allowed",
						)}
						onClick={handleCard1Toggle}
						aria-expanded={card1Open}
						disabled={phase === "installing"}
					>
						<div className="min-w-0">
							<h2 className="text-base font-semibold text-foreground">
								{t("repositoryAndCredentials")}
							</h2>
							{!card1Open && urlValue && (
								<p className="mt-0.5 truncate text-xs text-muted">
									{urlValue}
								</p>
							)}
						</div>
						<span className="ml-3 shrink-0 text-muted">
							<ChevronDownIcon
								className={cn(
									"size-4 transition-transform duration-300",
									card1Open ? "rotate-0" : "-rotate-90",
								)}
							/>
						</span>
					</button>

					<div
						className={cn(
							"grid transition-[grid-template-rows] duration-300 ease-out",
							card1Open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
						)}
					>
						<div className="overflow-hidden px-0.5">
							<Card.Content className="pt-0">
								{scanError && (
									<Alert className="mb-4" status="danger">
										<Alert.Indicator />
										<Alert.Content>
											<Alert.Description>
												{scanError}
											</Alert.Description>
										</Alert.Content>
									</Alert>
								)}

								<Form
									className="space-y-4"
									validationBehavior="aria"
									onSubmit={handleSubmit(handleScan)}
								>
									<Fieldset>
										<Fieldset.Group>
											<Controller
												name="url"
												control={control}
												rules={{
													required: t(
														"validationUrlRequired",
													),
													validate: (value) => {
														if (!value.trim())
															return t(
																"validationUrlRequired",
															);
														try {
															const u = new URL(
																value.trim(),
															);
															if (
																u.protocol !==
																"https:"
															)
																return t(
																	"validationUrlHttpsOnly",
																);
														} catch {
															return t(
																"validationUrlInvalid",
															);
														}
														return true;
													},
												}}
												render={({
													field,
													fieldState,
												}) => (
													<TextField
														className="w-full"
														isRequired
														validationBehavior="aria"
														isInvalid={Boolean(
															fieldState.error,
														)}
													>
														<Label>
															{t("githubRepoUrl")}
														</Label>
														<Input
															value={field.value}
															onChange={
																field.onChange
															}
															onBlur={
																field.onBlur
															}
															placeholder={t(
																"githubRepoUrlPlaceholder",
															)}
															variant="secondary"
														/>
														{fieldState.error && (
															<FieldError>
																{
																	fieldState
																		.error
																		.message
																}
															</FieldError>
														)}
													</TextField>
												)}
											/>
										</Fieldset.Group>
									</Fieldset>

									{/* Private repo checkbox */}
									<Checkbox
										variant="secondary"
										isSelected={isPrivateRepo}
										onChange={(checked) => {
											setIsPrivateRepo(checked);
											if (!checked)
												setValue("credentialId", "");
										}}
									>
										<Checkbox.Content>
											<Checkbox.Control>
												<Checkbox.Indicator />
											</Checkbox.Control>
											<Label>{t("privateRepo")}</Label>
										</Checkbox.Content>
									</Checkbox>

									{/* Credential dropdown */}
									{isPrivateRepo && (
										<Fieldset>
											<Fieldset.Group>
												<Controller
													name="credentialId"
													control={control}
													render={({ field }) => (
														<Select
															className="w-full"
															variant="secondary"
															selectedKey={
																field.value ||
																undefined
															}
															onSelectionChange={(
																key,
															) => {
																if (
																	key ===
																	ADD_TOKEN_SENTINEL
																) {
																	setIsAddTokenOpen(
																		true,
																	);
																	return;
																}
																field.onChange(
																	String(key),
																);
															}}
														>
															<Label>
																{t(
																	"selectCredential",
																)}
															</Label>
															<Select.Trigger>
																<Select.Value />
																<Select.Indicator />
															</Select.Trigger>
															<Select.Popover>
																<ListBox>
																	{credentials.map(
																		(
																			cred,
																		) => (
																			<ListBox.Item
																				key={
																					cred.id
																				}
																				id={
																					cred.id
																				}
																				textValue={
																					cred.name
																				}
																			>
																				{
																					cred.name
																				}
																				<ListBox.ItemIndicator />
																			</ListBox.Item>
																		),
																	)}
																	<ListBox.Section className="mt-1 border-t border-border pt-1">
																		<ListBox.Item
																			id={
																				ADD_TOKEN_SENTINEL
																			}
																			textValue={t(
																				"addToken",
																			)}
																		>
																			{t(
																				"addToken",
																			)}
																		</ListBox.Item>
																	</ListBox.Section>
																</ListBox>
															</Select.Popover>
														</Select>
													)}
												/>
											</Fieldset.Group>
										</Fieldset>
									)}

									<div className="flex justify-end gap-2 pt-2">
										<Button
											type="button"
											variant="secondary"
											isDisabled={phase === "installing"}
											onPress={handleDone}
										>
											{t("cancel")}
										</Button>
										<Button
											type="submit"
											isDisabled={
												scanMutation.isPending ||
												isSubmitting ||
												!skillAuditReady ||
												skillAgents.length === 0
											}
										>
											{scanMutation.isPending ? (
												<span className="flex items-center gap-2">
													<Spinner
														size="sm"
														color="current"
													/>
													{t("scanningRepo")}
												</span>
											) : (
												t("scanRepo")
											)}
										</Button>
									</div>
								</Form>
							</Card.Content>
						</div>
					</div>
				</Card>

				<Card
					className={cn(
						!card2Active && "opacity-60",
						!visibleCard2Open && "!pb-0",
					)}
				>
					<div className="flex w-full items-center justify-between gap-3">
						<button
							type="button"
							className={cn(
								"flex min-w-0 flex-1 flex-col text-left",
								!card2Reached && "cursor-not-allowed",
							)}
							onClick={handleCard2Toggle}
							aria-expanded={visibleCard2Open}
							disabled={!card2Reached}
						>
							<h2 className="text-base font-semibold text-foreground">
								{t("selectSkillsToInstall")}
							</h2>
							{!visibleCard2Open && card2Reached && (
								<p className="mt-0.5 text-xs text-muted">
									{selectedPaths.size} {t("skillsSelected")}
								</p>
							)}
						</button>
						<div className="flex shrink-0 items-center gap-3">
							{card2Active && (
								<div className="flex gap-1">
									<Button
										variant="ghost"
										size="sm"
										isDisabled={isBranchSwitching}
										onPress={selectAll}
									>
										{t("selectAll")}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										isDisabled={isBranchSwitching}
										onPress={deselectAll}
									>
										{t("deselectAll")}
									</Button>
								</div>
							)}
							<button
								type="button"
								className={cn(
									"text-muted",
									!card2Reached && "cursor-not-allowed",
								)}
								onClick={handleCard2Toggle}
								disabled={!card2Reached}
								aria-hidden
								tabIndex={-1}
							>
								<ChevronDownIcon
									className={cn(
										"size-4 transition-transform duration-300",
										visibleCard2Open
											? "rotate-0"
											: "-rotate-90",
									)}
								/>
							</button>
						</div>
					</div>

					<div
						className={cn(
							"grid transition-[grid-template-rows] duration-300 ease-out",
							visibleCard2Open
								? "grid-rows-[1fr]"
								: "grid-rows-[0fr]",
						)}
					>
						<div className="overflow-hidden px-0.5">
							<Card.Content className="space-y-4 pt-0">
								{installError && (
									<Alert status="danger">
										<Alert.Indicator />
										<Alert.Content>
											<Alert.Description>
												{installError}
											</Alert.Description>
										</Alert.Content>
									</Alert>
								)}

								{/* Branch selector */}
								{branches.length > 0 && (
									<Select
										className="w-full"
										variant="secondary"
										selectedKey={currentBranch}
										isDisabled={
											phase !== "selecting" ||
											isBranchSwitching
										}
										onSelectionChange={(key) => {
											handleBranchScan(String(key));
										}}
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

								{scannedSkills.length === 0 ? (
									<p className="py-6 text-center text-sm text-muted">
										{t("noSkillsFoundInRepo")}
									</p>
								) : (
									<div className="space-y-2">
										{scannedSkills.map((skill) => (
											<div
												key={skill.path}
												className="space-y-1.5"
											>
												<div
													className={cn(
														"flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-surface-secondary data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/5",
														(phase !==
															"selecting" ||
															isBranchSwitching) &&
															"opacity-60",
													)}
													data-selected={selectedPaths.has(
														skill.path,
													)}
												>
													<Checkbox
														className="min-w-0 flex-1 items-start gap-3"
														isSelected={selectedPaths.has(
															skill.path,
														)}
														isDisabled={
															phase !==
																"selecting" ||
															isBranchSwitching
														}
														onChange={() =>
															togglePath(
																skill.path,
															)
														}
														aria-label={skill.name}
													>
														<Checkbox.Content className="min-w-0 flex-1">
															<Checkbox.Control>
																<Checkbox.Indicator />
															</Checkbox.Control>
															<div className="flex flex-wrap items-center gap-2">
																<BookOpenIcon className="size-4 shrink-0 text-muted" />
																<span className="font-medium text-foreground">
																	{skill.name}
																</span>
																{skill.version && (
																	<Chip
																		size="sm"
																		variant="secondary"
																	>
																		v
																		{
																			skill.version
																		}
																	</Chip>
																)}
																{skill.author && (
																	<Chip
																		size="sm"
																		variant="secondary"
																	>
																		{
																			skill.author
																		}
																	</Chip>
																)}
															</div>
															{skill.description && (
																<p className="mt-1 text-sm text-muted">
																	{
																		skill.description
																	}
																</p>
															)}
														</Checkbox.Content>
													</Checkbox>
													<Button
														variant="ghost"
														size="sm"
														isIconOnly
														aria-label={t(
															"description",
														)}
														onPress={() =>
															setPreviewSkill(
																skill,
															)
														}
													>
														<EyeIcon className="size-4" />
													</Button>
												</div>
												{skillAuditEnabled &&
													skill.audit && (
														<SkillAudit
															report={skill.audit}
															embedded
														/>
													)}
											</div>
										))}
									</div>
								)}

								<Controller
									name="selectedAgents"
									control={control}
									rules={{
										validate: (value) =>
											value.length > 0
												? true
												: t("validationAgentsRequired"),
									}}
									render={({ field, fieldState }) => (
										<SkillTargetSelector
											agents={skillAgents}
											scope={
												projectPath
													? "project"
													: "global"
											}
											selectedKeys={new Set(field.value)}
											onSelectionChange={(keys) =>
												field.onChange([...keys])
											}
											label={t("targetAgent")}
											variant="secondary"
											isDisabled={
												phase !== "selecting" ||
												isBranchSwitching
											}
											errorMessage={
												fieldState.error?.message
											}
										/>
									)}
								/>

								{phase === "selecting" && (
									<div className="flex justify-end gap-2 pt-2">
										<Button
											variant="secondary"
											onPress={handleCard1Toggle}
										>
											{t("back")}
										</Button>
										<Button
											isDisabled={
												selectedPaths.size === 0 ||
												!skillAuditReady ||
												isBranchSwitching
											}
											onPress={() => {
												handleSubmit((values) => {
													handleInstall(
														values.selectedAgents,
													);
												})();
											}}
										>
											{t("installSelected")}
										</Button>
									</div>
								)}
							</Card.Content>
						</div>
					</div>
				</Card>

				{showAuditStep && (
					<Card
						className={cn(
							!card3Active && "opacity-60",
							!visibleCard3Open && "!pb-0",
						)}
					>
						<button
							type="button"
							className={cn(
								"flex w-full items-center justify-between text-left",
								!card3Reached && "cursor-not-allowed",
							)}
							onClick={handleCard3Toggle}
							aria-expanded={visibleCard3Open}
							disabled={!card3Reached}
						>
							<div className="min-w-0">
								<h2 className="text-base font-semibold text-foreground">
									{t("securityAudit")}
								</h2>
							</div>
							<span className="ml-3 shrink-0 text-muted">
								<ChevronDownIcon
									className={cn(
										"size-4 transition-transform duration-300",
										visibleCard3Open
											? "rotate-0"
											: "-rotate-90",
									)}
								/>
							</span>
						</button>

						<div
							className={cn(
								"grid transition-[grid-template-rows] duration-300 ease-out",
								visibleCard3Open
									? "grid-rows-[1fr]"
									: "grid-rows-[0fr]",
							)}
						>
							<div className="overflow-hidden px-0.5">
								<Card.Content className="space-y-4 pt-0">
									{phase === "auditing" ? (
										<div className="flex flex-col items-center gap-3 py-6">
											<Spinner size="lg" />
											<p className="text-sm text-muted">
												{t("auditing")}
											</p>
										</div>
									) : (
										<>
											{auditReport && (
												<SkillAudit
													report={auditReport}
													embedded
												/>
											)}
											{phase === "review" && (
												<div className="space-y-3">
													<p className="text-sm text-danger">
														{t("auditBlockedHint")}
													</p>
													<div className="flex justify-end gap-2 pt-2">
														<Button
															variant="secondary"
															onPress={() => {
																setCard2Open(
																	true,
																);
																setCard3Open(
																	false,
																);
																dropAuditReview();
																setBasePhase(
																	"selecting",
																);
															}}
														>
															{t("back")}
														</Button>
														<Button
															variant="danger"
															onPress={
																handleConfirmInstall
															}
														>
															{t("installAnyway")}
														</Button>
													</div>
												</div>
											)}
										</>
									)}
								</Card.Content>
							</div>
						</div>
					</Card>
				)}

				<Card
					className={cn(
						!card4Active && "opacity-60",
						!visibleCard4Open && "!pb-0",
					)}
				>
					<button
						type="button"
						className={cn(
							"flex w-full items-center justify-between text-left",
							!card4Reached && "cursor-not-allowed",
						)}
						onClick={handleCard4Toggle}
						aria-expanded={visibleCard4Open}
						disabled={!card4Reached}
					>
						<div className="min-w-0">
							<h2 className="text-base font-semibold text-foreground">
								{phase === "done"
									? t("installComplete")
									: phase === "installing"
										? t("installingSkills")
										: t("installSkill")}
							</h2>
							{!visibleCard4Open && phase === "done" && (
								<p className="mt-0.5 text-xs text-muted">
									{successCount}{" "}
									{t("installed").toLowerCase()}
									{failCount > 0 &&
										`, ${failCount} ${t("skillsFailed")}`}
								</p>
							)}
						</div>
						<span className="ml-3 shrink-0 text-muted">
							<ChevronDownIcon
								className={cn(
									"size-4 transition-transform duration-300",
									visibleCard4Open
										? "rotate-0"
										: "-rotate-90",
								)}
							/>
						</span>
					</button>

					<div
						className={cn(
							"grid transition-[grid-template-rows] duration-300 ease-out",
							visibleCard4Open
								? "grid-rows-[1fr]"
								: "grid-rows-[0fr]",
						)}
					>
						<div className="overflow-hidden px-0.5">
							<Card.Content className="space-y-4 pt-0">
								{phase === "installing" ? (
									<div className="flex flex-col items-center gap-3 py-6">
										<Spinner size="lg" />
										<p className="text-sm text-muted">
											{t("installingSkills")}
										</p>
									</div>
								) : (
									<>
										<div className="space-y-4">
											{Object.entries(
												installResults.reduce<
													Record<
														string,
														GitInstallResultEntry[]
													>
												>((acc, result) => {
													if (!acc[result.name]) {
														acc[result.name] = [];
													}
													acc[result.name].push(
														result,
													);
													return acc;
												}, {}),
											).map(([skillName, results]) => {
												const allSuccess =
													results.every(
														(r) => r.success,
													);
												const hasError = results.some(
													(r) => !r.success,
												);
												const errorMsg = results.find(
													(r) => r.error,
												)?.error;
												return (
													<div
														key={skillName}
														className="flex items-start gap-2 rounded-lg px-2 py-1.5"
													>
														{allSuccess ? (
															<CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-success" />
														) : hasError ? (
															<XCircleIcon className="mt-0.5 size-4 shrink-0 text-danger" />
														) : null}
														<div className="min-w-0">
															<p className="text-sm font-medium text-foreground">
																{skillName}
															</p>
															<p className="text-xs text-muted">
																{results
																	.map(
																		(r) =>
																			r.agent,
																	)
																	.join(", ")}
															</p>
															{errorMsg && (
																<p className="text-xs text-danger">
																	{errorMsg}
																</p>
															)}
														</div>
													</div>
												);
											})}
										</div>

										<div className="mt-4 flex items-center justify-between">
											<p className="text-sm text-muted">
												{successCount}{" "}
												{t("installed").toLowerCase()}
												{failCount > 0 &&
													`, ${failCount} ${t("skillsFailed")}`}
											</p>
											<div className="flex gap-2">
												<Button
													variant="secondary"
													onPress={
														handleImportAnother
													}
												>
													{t("importAnother")}
												</Button>
												<Button onPress={handleDone}>
													{t("done")}
												</Button>
											</div>
										</div>
									</>
								)}
							</Card.Content>
						</div>
					</div>
				</Card>
			</div>

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
									<p className="mb-1 text-xs font-medium text-muted">
										{t("description")}
									</p>
									<p className="text-sm text-foreground">
										{previewSkill.description}
									</p>
								</div>
							)}
							{previewSkill?.version && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted">
										{t("version")}
									</p>
									<p className="text-sm text-foreground">
										{previewSkill.version}
									</p>
								</div>
							)}
							{previewSkill?.author && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted">
										{t("author")}
									</p>
									<p className="text-sm text-foreground">
										{previewSkill.author}
									</p>
								</div>
							)}
							{previewSkill?.path && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted">
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
					if (newId) setValue("credentialId", newId);
				}}
			/>
		</div>
	);
}

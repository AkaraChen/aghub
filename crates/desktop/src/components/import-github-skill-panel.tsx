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
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type {
	GitInstallResultEntry,
	GitScanSkillEntry,
} from "../lib/api-types";
import { cn } from "../lib/utils";
import { CreateCredentialDialog } from "../pages/settings/components/create-credential-dialog";
import { AgentSelector } from "./agent-selector";

interface ImportGithubSkillPanelProps {
	onDone: () => void;
	projectPath?: string;
}

const ADD_TOKEN_SENTINEL = "__add_token__";

interface InputFormValues {
	url: string;
	credentialId: string;
	selectedAgents: string[];
}

type Phase = "scanning" | "selecting" | "installing" | "done";

// Which cards have been reached at least once for a given phase
function cardReached(card: 1 | 2 | 3, phase: Phase): boolean {
	const order: Phase[] = ["scanning", "selecting", "installing", "done"];
	const thresholds: Record<1 | 2 | 3, Phase> = {
		1: "scanning",
		2: "selecting",
		3: "installing",
	};
	return order.indexOf(phase) >= order.indexOf(thresholds[card]);
}

export function ImportGithubSkillPanel({
	onDone,
	projectPath,
}: ImportGithubSkillPanelProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const skillAgents = useMemo(
		() =>
			availableAgents.filter(
				(a) => a.isUsable && a.capabilities.skills_mutable,
			),
		[availableAgents],
	);

	const [phase, setPhase] = useState<Phase>("scanning");
	const [card1Open, setCard1Open] = useState(true);
	const [card2Open, setCard2Open] = useState(false);
	const [card3Open, setCard3Open] = useState(false);
	const [isPrivateRepo, setIsPrivateRepo] = useState(false);
	const [isAddTokenOpen, setIsAddTokenOpen] = useState(false);
	const [scannedSkills, setScannedSkills] = useState<GitScanSkillEntry[]>([]);
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
	const [sessionId, setSessionId] = useState<string>("");
	const [installResults, setInstallResults] = useState<
		GitInstallResultEntry[]
	>([]);
	const [scanError, setScanError] = useState<string | null>(null);
	const [installError, setInstallError] = useState<string | null>(null);
	const [previewSkill, setPreviewSkill] = useState<GitScanSkillEntry | null>(
		null,
	);

	const { data: credentials = [] } = useQuery({
		queryKey: ["credentials"],
		queryFn: () => api.credentials.list(),
	});

	const {
		control,
		handleSubmit,
		watch,
		reset,
		setValue,
		formState: { isSubmitting },
	} = useForm<InputFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			url: "",
			credentialId: "",
			selectedAgents: skillAgents[0] ? [skillAgents[0].id] : [],
		},
	});

	const urlValue = watch("url");

	const scanMutation = useMutation({
		mutationFn: (values: InputFormValues) =>
			api.skills.gitScan({
				url: values.url.trim(),
				credential_id: values.credentialId || undefined,
			}),
		onSuccess: (data) => {
			setScanError(null);
			setScannedSkills(data.skills);
			setSessionId(data.session_id);
			setSelectedPaths(new Set(data.skills.map((s) => s.path)));
			setCard1Open(false);
			setCard2Open(true);
			setPhase("selecting");
		},
		onError: (error) => {
			setScanError(
				error instanceof Error ? error.message : String(error),
			);
		},
	});

	const installMutation = useMutation({
		mutationFn: ({ agents }: { agents: string[] }) =>
			api.skills.gitInstall({
				session_id: sessionId,
				skill_paths: Array.from(selectedPaths),
				agents,
				scope: projectPath ? "project" : "global",
				project_root: projectPath,
			}),
		onSuccess: (data) => {
			setInstallError(null);
			setInstallResults(data.results);
			queryClient.invalidateQueries({ queryKey: ["skills"] });
			queryClient.invalidateQueries({ queryKey: ["project-skills"] });
			queryClient.invalidateQueries({ queryKey: ["skill-locks"] });
			setCard2Open(false);
			setCard3Open(true);
			setPhase("done");
		},
		onError: (error) => {
			setInstallError(
				error instanceof Error ? error.message : String(error),
			);
			setPhase("selecting");
		},
	});

	const handleScan = (values: InputFormValues) => {
		setScanError(null);
		scanMutation.mutate(values);
	};

	const handleInstall = (agents: string[]) => {
		setInstallError(null);
		setCard2Open(false);
		setCard3Open(true);
		setPhase("installing");
		installMutation.mutate({ agents });
	};

	const handleImportAnother = () => {
		reset();
		setIsPrivateRepo(false);
		setScannedSkills([]);
		setSelectedPaths(new Set());
		setSessionId("");
		setInstallResults([]);
		setScanError(null);
		setInstallError(null);
		setCard1Open(true);
		setCard2Open(false);
		setCard3Open(false);
		setPhase("scanning");
		scanMutation.reset();
		installMutation.reset();
	};

	// Card 1 toggle: re-opening resets everything back to scanning
	const handleCard1Toggle = () => {
		if (!card1Open) {
			// Reset all downstream state
			setScannedSkills([]);
			setSelectedPaths(new Set());
			setSessionId("");
			setInstallResults([]);
			setScanError(null);
			setInstallError(null);
			setCard2Open(false);
			setCard3Open(false);
			setPhase("scanning");
			scanMutation.reset();
			installMutation.reset();
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

	const togglePath = (path: string) => {
		setSelectedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const selectAll = () =>
		setSelectedPaths(new Set(scannedSkills.map((s) => s.path)));
	const deselectAll = () => setSelectedPaths(new Set());

	const successCount = installResults.filter((r) => r.success).length;
	const failCount = installResults.filter((r) => !r.success).length;

	// Derived disabled / active states
	const card1Active = phase === "scanning";
	const card2Active = phase === "selecting";
	const card3Active = phase === "installing" || phase === "done";

	const card2Reached = cardReached(2, phase);
	const card3Reached = cardReached(3, phase);

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			<div className="space-y-3">
				{/* ── Panel title ── */}
				<div className="mb-5">
					<h1 className="text-xl font-semibold text-foreground">
						{t("importFromGitRepository")}
					</h1>
				</div>

				{/* ── Card 1: Repository & Credential ── */}
				<Card
					className={cn(
						!card1Active && "opacity-60",
						!card1Open && "!pb-0",
					)}
				>
					<button
						type="button"
						className="flex w-full items-center justify-between text-left"
						onClick={handleCard1Toggle}
						aria-expanded={card1Open}
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
							card1Open
								? "grid-rows-expand"
								: "grid-rows-collapse",
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
																return "Only HTTPS URLs are supported";
														} catch {
															return "Please enter a valid URL";
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
										<Checkbox.Control>
											<Checkbox.Indicator />
										</Checkbox.Control>
										<Checkbox.Content>
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
											onPress={onDone}
										>
											{t("cancel")}
										</Button>
										<Button
											type="submit"
											isDisabled={
												scanMutation.isPending ||
												isSubmitting ||
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

				{/* ── Card 2: Select Skills + Target Agent ── */}
				<Card
					className={cn(
						!card2Active && "opacity-60",
						!card2Open && "!pb-0",
					)}
				>
					<button
						type="button"
						className={cn(
							"flex w-full items-center justify-between text-left",
							!card2Reached && "cursor-not-allowed",
						)}
						onClick={handleCard2Toggle}
						aria-expanded={card2Open}
						disabled={!card2Reached}
					>
						<div className="min-w-0">
							<h2 className="text-base font-semibold text-foreground">
								{t("selectSkillsToInstall")}
							</h2>
							{!card2Open && card2Reached && (
								<p className="mt-0.5 text-xs text-muted">
									{selectedPaths.size} {t("skillsSelected")}
								</p>
							)}
						</div>
						<div className="ml-3 flex shrink-0 items-center gap-3">
							{card2Active && (
								// eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
								<div
									className="flex gap-1"
									onClick={(e) => e.stopPropagation()}
								>
									<Button
										variant="ghost"
										size="sm"
										onPress={selectAll}
									>
										{t("selectAll")}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onPress={deselectAll}
									>
										{t("deselectAll")}
									</Button>
								</div>
							)}
							<span className="text-muted">
								<ChevronDownIcon
									className={cn(
										"size-4 transition-transform duration-300",
										card2Open ? "rotate-0" : "-rotate-90",
									)}
								/>
							</span>
						</div>
					</button>

					<div
						className={cn(
							"grid transition-[grid-template-rows] duration-300 ease-out",
							card2Open
								? "grid-rows-expand"
								: "grid-rows-collapse",
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

								{scannedSkills.length === 0 ? (
									<p className="py-6 text-center text-sm text-muted">
										{t("noSkillsFoundInRepo")}
									</p>
								) : (
									<div className="space-y-2">
										{scannedSkills.map((skill) => (
											<button
												key={skill.path}
												type="button"
												onClick={() => {
													if (phase === "selecting")
														togglePath(skill.path);
												}}
												disabled={phase !== "selecting"}
												className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60 data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/5"
												data-selected={selectedPaths.has(
													skill.path,
												)}
											>
												<Checkbox
													isSelected={selectedPaths.has(
														skill.path,
													)}
													isDisabled={
														phase !== "selecting"
													}
													onChange={() =>
														togglePath(skill.path)
													}
													aria-label={skill.name}
												>
													<Checkbox.Control>
														<Checkbox.Indicator />
													</Checkbox.Control>
												</Checkbox>
												<div className="min-w-0 flex-1">
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
																v{skill.version}
															</Chip>
														)}
														{skill.author && (
															<Chip
																size="sm"
																variant="secondary"
															>
																{skill.author}
															</Chip>
														)}
													</div>
													{skill.description && (
														<p className="mt-1 text-sm text-muted">
															{skill.description}
														</p>
													)}
												</div>
												{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
												<div
													onClick={(e) =>
														e.stopPropagation()
													}
												>
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
											</button>
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
										<AgentSelector
											agents={skillAgents}
											selectedKeys={new Set(field.value)}
											onSelectionChange={(keys) =>
												field.onChange([...keys])
											}
											label={t("targetAgent")}
											emptyMessage={t(
												"noAgentsAvailable",
											)}
											emptyHelpText={t(
												"noAgentsAvailableHelp",
											)}
											variant="secondary"
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
												selectedPaths.size === 0
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

				{/* ── Card 3: Install progress / results ── */}
				<Card
					className={cn(
						!card3Active && "opacity-60",
						!card3Open && "!pb-0",
					)}
				>
					<button
						type="button"
						className={cn(
							"flex w-full items-center justify-between text-left",
							!card3Reached && "cursor-not-allowed",
						)}
						onClick={handleCard3Toggle}
						aria-expanded={card3Open}
						disabled={!card3Reached}
					>
						<div className="min-w-0">
							<h2 className="text-base font-semibold text-foreground">
								{phase === "done"
									? t("installComplete")
									: t("installingSkills")}
							</h2>
							{!card3Open && phase === "done" && (
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
									card3Open ? "rotate-0" : "-rotate-90",
								)}
							/>
						</span>
					</button>

					<div
						className={cn(
							"grid transition-[grid-template-rows] duration-300 ease-out",
							card3Open
								? "grid-rows-expand"
								: "grid-rows-collapse",
						)}
					>
						<div className="overflow-hidden px-0.5">
							<Card.Content className="pt-0">
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
												<Button onPress={onDone}>
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
					queryClient.invalidateQueries({
						queryKey: ["credentials"],
					});
					if (newId) setValue("credentialId", newId);
				}}
			/>
		</div>
	);
}

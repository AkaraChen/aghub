import {
	BookOpenIcon,
	CheckCircleIcon,
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
	Select,
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
import { AgentSelector } from "./agent-selector";

interface ImportGithubSkillPanelProps {
	onDone: () => void;
	projectPath?: string;
}

interface InputFormValues {
	url: string;
	credentialId: string;
	selectedAgents: string[];
}

type Step = "input" | "select" | "done";

function isGitHubUrl(url: string): boolean {
	try {
		return new URL(url).hostname.endsWith("github.com");
	} catch {
		return false;
	}
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

	const [step, setStep] = useState<Step>("input");
	const [scannedSkills, setScannedSkills] = useState<GitScanSkillEntry[]>([]);
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
	const [sessionId, setSessionId] = useState<string>("");
	const [installResults, setInstallResults] = useState<
		GitInstallResultEntry[]
	>([]);
	const [scanError, setScanError] = useState<string | null>(null);
	const [installError, setInstallError] = useState<string | null>(null);

	const { data: credentials = [] } = useQuery({
		queryKey: ["credentials"],
		queryFn: () => api.credentials.list(),
	});

	const {
		control,
		handleSubmit,
		watch,
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
	const showCredentials = isGitHubUrl(urlValue);

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
			setStep("select");
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
			setStep("done");
		},
		onError: (error) => {
			setInstallError(
				error instanceof Error ? error.message : String(error),
			);
		},
	});

	const handleScan = (values: InputFormValues) => {
		setScanError(null);
		scanMutation.mutate(values);
	};

	const handleInstall = (agents: string[]) => {
		setInstallError(null);
		installMutation.mutate({ agents });
	};

	const togglePath = (path: string) => {
		setSelectedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	const selectAll = () =>
		setSelectedPaths(new Set(scannedSkills.map((s) => s.path)));
	const deselectAll = () => setSelectedPaths(new Set());

	if (step === "done") {
		const successCount = installResults.filter((r) => r.success).length;
		const failCount = installResults.filter((r) => !r.success).length;

		return (
			<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
				<Card>
					<Card.Header>
						<h2 className="text-xl font-semibold text-foreground">
							{t("installComplete")}
						</h2>
					</Card.Header>
					<Card.Content>
						<div className="space-y-2">
							{installResults.map((result, idx) => (
								<div
									key={`${result.agent}-${result.name}-${idx}`}
									className="flex items-start gap-2 rounded-lg px-2 py-1.5"
								>
									{result.success ? (
										<CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-success" />
									) : (
										<XCircleIcon className="mt-0.5 size-4 shrink-0 text-danger" />
									)}
									<div className="min-w-0">
										<p className="text-sm font-medium text-foreground">
											{result.name}
										</p>
										<p className="text-xs text-muted">
											{result.agent}
										</p>
										{result.error && (
											<p className="text-xs text-danger">
												{result.error}
											</p>
										)}
									</div>
								</div>
							))}
						</div>
						<div className="mt-4 flex items-center justify-between">
							<p className="text-sm text-muted">
								{successCount} installed
								{failCount > 0 && `, ${failCount} failed`}
							</p>
							<Button onPress={onDone}>{t("done")}</Button>
						</div>
					</Card.Content>
				</Card>
			</div>
		);
	}

	if (step === "select") {
		return (
			<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
				{installError && (
					<Alert className="mb-4" status="danger">
						<Alert.Indicator />
						<Alert.Content>
							<Alert.Description>
								{installError}
							</Alert.Description>
						</Alert.Content>
					</Alert>
				)}

				<Card>
					<Card.Header>
						<div className="flex items-center justify-between">
							<h2 className="text-xl font-semibold text-foreground">
								{t("selectSkillsToInstall")}
							</h2>
							<div className="flex gap-2">
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
						</div>
					</Card.Header>

					<Card.Content>
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
										onClick={() => togglePath(skill.path)}
										className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-surface-secondary data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/5"
										data-selected={selectedPaths.has(
											skill.path,
										)}
									>
										<Checkbox
											isSelected={selectedPaths.has(
												skill.path,
											)}
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
									</button>
								))}
							</div>
						)}
					</Card.Content>
				</Card>

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
						<Card className="mt-4">
							<Card.Content>
								<AgentSelector
									agents={skillAgents}
									selectedKeys={new Set(field.value)}
									onSelectionChange={(keys) =>
										field.onChange([...keys])
									}
									label={t("targetAgent")}
									emptyMessage={t("noAgentsAvailable")}
									emptyHelpText={t("noAgentsAvailableHelp")}
									variant="secondary"
									errorMessage={fieldState.error?.message}
								/>
							</Card.Content>
						</Card>
					)}
				/>

				<div className="mt-4 flex justify-end gap-2">
					<Button
						variant="secondary"
						onPress={() => setStep("input")}
					>
						{t("back")}
					</Button>
					<Button
						isDisabled={
							selectedPaths.size === 0 ||
							installMutation.isPending
						}
						onPress={() => {
							handleSubmit((values) => {
								handleInstall(values.selectedAgents);
							})();
						}}
					>
						{installMutation.isPending
							? t("installingSkills")
							: t("installSelected")}
					</Button>
				</div>
			</div>
		);
	}

	// Step: "input"
	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			{scanError && (
				<Alert className="mb-4" status="danger">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Description>{scanError}</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			<Card>
				<Card.Header>
					<h2 className="text-xl font-semibold text-foreground">
						{t("importFromGithub")}
					</h2>
				</Card.Header>

				<Card.Content>
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
										required: t("validationPathRequired"),
										validate: (value) => {
											if (!value.trim())
												return t(
													"validationPathRequired",
												);
											try {
												const u = new URL(value.trim());
												if (u.protocol !== "https:")
													return "Only HTTPS URLs are supported";
											} catch {
												return "Please enter a valid URL";
											}
											return true;
										},
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											isRequired
											validationBehavior="aria"
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>{t("githubRepoUrl")}</Label>
											<Input
												value={field.value}
												onChange={field.onChange}
												onBlur={field.onBlur}
												placeholder={t(
													"githubRepoUrlPlaceholder",
												)}
												variant="secondary"
											/>
											{fieldState.error && (
												<FieldError>
													{fieldState.error.message}
												</FieldError>
											)}
										</TextField>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						{showCredentials && credentials.length > 0 && (
							<Fieldset>
								<Fieldset.Group>
									<Controller
										name="credentialId"
										control={control}
										render={({ field }) => (
											<Select
												className="w-full"
												variant="secondary"
												selectedKey={field.value}
												onSelectionChange={(key) =>
													field.onChange(
														key === "__none__"
															? ""
															: String(key),
													)
												}
											>
												<Label>
													{t("selectCredential")}
												</Label>
												<Select.Trigger>
													<Select.Value />
													<Select.Indicator />
												</Select.Trigger>
												<Select.Popover>
													<ListBox>
														<ListBox.Item
															id="__none__"
															textValue={t(
																"publicRepoNoCredential",
															)}
														>
															{t(
																"publicRepoNoCredential",
															)}
															<ListBox.ItemIndicator />
														</ListBox.Item>
														{credentials.map(
															(cred) => (
																<ListBox.Item
																	key={
																		cred.id
																	}
																	id={cred.id}
																	textValue={
																		cred.name
																	}
																>
																	{cred.name}
																	<ListBox.ItemIndicator />
																</ListBox.Item>
															),
														)}
													</ListBox>
												</Select.Popover>
											</Select>
										)}
									/>
								</Fieldset.Group>
							</Fieldset>
						)}

						<Fieldset>
							<Fieldset.Group>
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
							</Fieldset.Group>
						</Fieldset>

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
								{scanMutation.isPending
									? t("scanningRepo")
									: t("scanRepo")}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}

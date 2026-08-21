import { DocumentIcon, FolderOpenIcon } from "@heroicons/react/24/outline";
import {
	Alert,
	Button,
	Card,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	Spinner,
	TextField,
} from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { ImportSkillRequest } from "../generated/dto";
import { auditDisposition } from "../hooks/audited-mutation";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useAuditedMutation } from "../hooks/use-audited-mutation";
import { useSkillAuditPreference } from "../hooks/use-skill-audit-preference";
import { supportsIndividualSkillTarget } from "../lib/agent-capabilities";
import {
	invalidateSkillQueries,
	skillAuditQueryOptions,
} from "../requests/skills";
import { capture } from "../lib/analytics";
import { SkillAudit } from "./skill-audit";
import { SkillTargetSelector } from "./skill-target-selector";

interface ImportSkillPanelProps {
	onDone: () => void;
	projectPath?: string;
}

interface ImportSkillFormValues {
	importPath: string;
	selectedAgents: string[];
}

interface LocalImportCandidate {
	readonly path: string;
	readonly agents: readonly string[];
	readonly projectPath?: string;
}

export function ImportSkillPanel({
	onDone,
	projectPath,
}: ImportSkillPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const { skillAuditEnabled, skillAuditReady } = useSkillAuditPreference();

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

	const {
		control,
		handleSubmit,
		setValue,
		formState: { isSubmitting },
	} = useForm<ImportSkillFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			importPath: "",
			selectedAgents: ["universal"],
		},
	});

	const importPath = useWatch({ control, name: "importPath" });
	const auditPath = importPath?.trim() || undefined;
	const auditQuery = skillAuditQueryOptions({
		api,
		paths: auditPath ? [auditPath] : [],
		enabled: skillAuditReady && skillAuditEnabled,
	});
	const {
		data: skillAudit,
		error: auditError,
		isFetching: auditFetching,
	} = useQuery(auditQuery);

	const localImport = useAuditedMutation<LocalImportCandidate, true>({
		audit: async (candidate, signal) => {
			const report = await api.skills.audit(
				{ paths: [candidate.path] },
				signal,
			);
			return auditDisposition(report, null);
		},
		write: async (
			{ candidate, report, confirmedAssessmentDigest },
			signal,
		) => {
			const body: ImportSkillRequest = {
				path: candidate.path,
				expected_content_digest: report?.content_digest ?? null,
				confirmed_assessment_digest: confirmedAssessmentDigest,
			};
			await Promise.all(
				candidate.agents.map((agent) =>
					api.skills.import(
						agent,
						body,
						candidate.projectPath,
						signal,
					),
				),
			);
			await invalidateSkillQueries(queryClient);
			capture("skill imported", {
				agents: [...candidate.agents],
				scope: candidate.projectPath ? "project" : "global",
			});
			return {
				kind: "done",
				result: true,
				report: skillAuditEnabled ? report : null,
				sessionId: null,
			};
		},
	});

	const mutationAudit =
		localImport.state.tag === "review" ||
		localImport.state.tag === "writing" ||
		localImport.state.tag === "done"
			? localImport.state.report
			: null;
	const visibleAudit = mutationAudit ?? skillAudit ?? null;
	const installed = localImport.state.tag === "done";
	const isImporting = localImport.isBusy;
	const error =
		localImport.state.tag === "failed"
			? localImport.state.error.message
			: null;

	const auditPending =
		(skillAuditEnabled && Boolean(auditPath) && auditFetching) ||
		localImport.state.tag === "auditing";
	const auditFailed =
		skillAuditEnabled && Boolean(auditPath) && auditError != null;
	const requiresConfirmation = visibleAudit?.confirmation_required ?? false;

	const showAuditCard =
		Boolean(auditPath) &&
		((skillAuditEnabled && (auditPending || auditFailed)) ||
			visibleAudit != null ||
			localImport.state.tag === "review");
	const showInstallCard = isImporting || installed;

	const handleImportClick = (values: ImportSkillFormValues) => {
		if (
			!skillAuditReady ||
			auditPending ||
			auditFailed ||
			(skillAuditEnabled && !skillAudit)
		) {
			return;
		}
		if (localImport.state.tag === "review") {
			localImport.confirm();
			return;
		}

		const candidate: LocalImportCandidate = {
			path: values.importPath.trim(),
			agents: [...values.selectedAgents],
			projectPath,
		};
		const disposition =
			skillAuditEnabled && visibleAudit
				? auditDisposition(visibleAudit, null)
				: {
						kind: "allow" as const,
						report: null,
						sessionId: null,
					};
		localImport.start(
			candidate,
			disposition,
			disposition.kind === "review",
		);
	};

	const handleDone = () => {
		if (isImporting) return;
		localImport.reset();
		onDone();
	};

	const handleSelectFile = async () => {
		if (isImporting) return;
		const selected = await open({
			directory: false,
			multiple: false,
			filters: [
				{
					name: "Skill Files",
					extensions: ["zip", "skill", "json", "toml", "yaml", "yml"],
				},
				{ name: "All Files", extensions: ["*"] },
			],
		});
		if (selected && !Array.isArray(selected)) {
			localImport.reset();
			setValue("importPath", selected, {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
	};

	const handleSelectFolder = async () => {
		if (isImporting) return;
		const selected = await open({ directory: true, multiple: false });
		if (selected && !Array.isArray(selected)) {
			localImport.reset();
			setValue("importPath", selected, {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
	};

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			{error && (
				<Alert className="mb-4" status="danger">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Description>
							{t("importError", { error })}
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			<Card>
				<Card.Header>
					<h2 className="text-xl font-semibold text-foreground">
						{t("importFromFile")}
					</h2>
				</Card.Header>

				<Card.Content>
					<Form
						className="space-y-4"
						validationBehavior="aria"
						onSubmit={handleSubmit(handleImportClick)}
					>
						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="importPath"
									control={control}
									rules={{
										required: t("validationPathRequired"),
										validate: (value) =>
											value.trim()
												? true
												: t("validationPathRequired"),
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
											<Label>
												{t("selectFileOrFolder")}
											</Label>
											<div className="flex w-full items-center gap-2">
												<Input
													className="min-w-0 flex-1"
													value={field.value}
													readOnly
													placeholder={t(
														"selectedPath",
													)}
													variant="secondary"
												/>
												<div className="flex shrink-0 flex-col gap-2 sm:flex-row">
													<Button
														type="button"
														variant="secondary"
														isDisabled={isImporting}
														onPress={
															handleSelectFile
														}
													>
														<DocumentIcon
															className="size-4"
															aria-hidden="true"
														/>
														{t("file")}
													</Button>
													<Button
														type="button"
														variant="secondary"
														isDisabled={isImporting}
														onPress={
															handleSelectFolder
														}
													>
														<FolderOpenIcon
															className="size-4"
															aria-hidden="true"
														/>
														{t("folder")}
													</Button>
												</div>
											</div>
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

						{showAuditCard && (
							<Card variant="secondary">
								<Card.Content className="space-y-3">
									<p className="text-sm font-medium text-foreground">
										{t("securityAudit")}
									</p>
									{auditPending ? (
										<div className="flex items-center justify-center gap-3 py-6 text-sm text-muted">
											<Spinner size="sm" />
											{t("auditing")}
										</div>
									) : auditFailed ? (
										<Alert status="danger">
											<Alert.Indicator />
											<Alert.Content>
												<Alert.Description>
													{t("auditFailed")}
												</Alert.Description>
											</Alert.Content>
										</Alert>
									) : (
										visibleAudit && (
											<>
												{requiresConfirmation && (
													<p className="text-sm text-danger">
														{t("auditBlockedHint")}
													</p>
												)}
												<SkillAudit
													key={auditPath}
													report={visibleAudit}
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
										{installed
											? t("installComplete")
											: t("installingSkills")}
									</p>
									{isImporting ? (
										<div className="flex items-center justify-center gap-3 py-6 text-sm text-muted">
											<Spinner size="sm" />
											{t("importing")}
										</div>
									) : (
										<p className="text-sm text-muted">
											{t("installSuccess")}
										</p>
									)}
								</Card.Content>
							</Card>
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
										<SkillTargetSelector
											agents={skillAgents}
											selectedKeys={new Set(field.value)}
											onSelectionChange={(keys) =>
												field.onChange([...keys])
											}
											label={t("targetAgent")}
											variant="secondary"
											isDisabled={isImporting}
											errorMessage={
												fieldState.error?.message
											}
										/>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<div className="flex justify-end gap-2 pt-2">
							{installed ? (
								<Button type="button" onPress={handleDone}>
									{t("done")}
								</Button>
							) : (
								<>
									<Button
										type="button"
										variant="secondary"
										isDisabled={isImporting}
										onPress={handleDone}
									>
										{t("cancel")}
									</Button>
									<Button
										type="submit"
										variant={
											requiresConfirmation
												? "danger"
												: "primary"
										}
										isDisabled={
											isImporting ||
											isSubmitting ||
											skillAgents.length === 0 ||
											!skillAuditReady ||
											auditPending ||
											auditFailed ||
											(skillAuditEnabled && !skillAudit)
										}
									>
										{isImporting
											? t("importing")
											: auditPending
												? t("auditing")
												: requiresConfirmation
													? t("installAnyway")
													: t("import")}
									</Button>
								</>
							)}
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}

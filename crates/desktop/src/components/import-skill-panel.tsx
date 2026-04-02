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
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { ImportSkillRequest } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { supportsSkillMutation } from "../lib/agent-capabilities";
import { importSkillMutationOptions } from "../requests/skills";
import { AgentSelector } from "./agent-selector";

interface ImportSkillPanelProps {
	onDone: () => void;
	projectPath?: string;
}

interface ImportSkillFormValues {
	importPath: string;
	selectedAgents: string[];
}

export function ImportSkillPanel({
	onDone,
	projectPath,
}: ImportSkillPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const skillAgents = useMemo(
		() =>
			availableAgents.filter(
				(a) =>
					a.isUsable &&
					supportsSkillMutation(
						a,
						projectPath ? "project" : "global",
					),
			),
		[availableAgents, projectPath],
	);

	const [error, setError] = useState<string | null>(null);

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
			selectedAgents: skillAgents[0] ? [skillAgents[0].id] : [],
		},
	});

	const importMutation = useMutation({
		...importSkillMutationOptions({
			api,
			queryClient,
		}),
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setError(errorMessage);
		},
	});

	const handleImportClick = async (values: ImportSkillFormValues) => {
		const body: ImportSkillRequest = {
			path: values.importPath.trim(),
		};

		try {
			await Promise.all(
				values.selectedAgents.map((agent) =>
					importMutation.mutateAsync({
						agent,
						body,
						projectPath,
					}),
				),
			);
			onDone();
		} catch {
			// Error is handled by onError callback
		}
	};

	const handleSelectFile = async () => {
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
			setValue("importPath", selected, {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
	};

	const handleSelectFolder = async () => {
		const selected = await open({ directory: true, multiple: false });
		if (selected && !Array.isArray(selected)) {
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
									importMutation.isPending ||
									isSubmitting ||
									skillAgents.length === 0
								}
							>
								{importMutation.isPending
									? t("importing")
									: t("import")}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}

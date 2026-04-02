import {
	Alert,
	Button,
	Card,
	Description,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	TextArea,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { CreateSkillRequest } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { supportsSkillMutation } from "../lib/agent-capabilities";
import { createSkillMutationOptions } from "../requests/skills";
import { AgentSelector } from "./agent-selector";

interface CreateSkillPanelProps {
	onDone: () => void;
	projectPath?: string;
}

interface CreateSkillFormValues {
	name: string;
	description: string;
	author: string;
	content: string;
	toolsInput: string;
	selectedAgents: string[];
}

export function CreateSkillPanel({
	onDone,
	projectPath,
}: CreateSkillPanelProps) {
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
		formState: { isSubmitting },
	} = useForm<CreateSkillFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			name: "",
			description: "",
			author: "",
			content: "",
			toolsInput: "",
			selectedAgents: skillAgents[0] ? [skillAgents[0].id] : [],
		},
	});

	const createMutation = useMutation({
		...createSkillMutationOptions({
			api,
			queryClient,
		}),
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setError(errorMessage);
		},
	});

	const handleCreate = async (values: CreateSkillFormValues) => {
		const tools = values.toolsInput
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);

		const body: CreateSkillRequest = {
			name: values.name.trim(),
			description: values.description.trim() || null,
			author: values.author.trim() || null,
			version: null,
			content: values.content.trim() || null,
			tools: tools.length > 0 ? tools : null,
		};

		try {
			await Promise.all(
				values.selectedAgents.map((agent) =>
					createMutation.mutateAsync({
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

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			{error && (
				<Alert className="mb-4" status="danger">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Description>
							{t("createError", { error })}
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			<Card>
				<Card.Header>
					<h2 className="text-xl font-semibold text-foreground">
						{t("createCustomSkill")}
					</h2>
				</Card.Header>

				<Card.Content>
					<Form
						className="space-y-4"
						validationBehavior="aria"
						onSubmit={handleSubmit(handleCreate)}
					>
						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="name"
									control={control}
									rules={{
										required: t(
											"validationSkillNameRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationSkillNameRequired",
													),
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
											<Label>{t("skillName")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"skillNamePlaceholder",
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
								<Controller
									name="description"
									control={control}
									rules={{
										required: t(
											"validationDescriptionRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationDescriptionRequired",
													),
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
											<Label>{t("description")}</Label>
											<TextArea
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"descriptionPlaceholder",
												)}
												className="min-h-24"
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
								<Controller
									name="content"
									control={control}
									rules={{
										required: t(
											"validationContentRequired",
										),
										validate: (value) =>
											value.trim()
												? true
												: t(
														"validationContentRequired",
													),
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
											<Label>{t("content")}</Label>
											<TextArea
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"skillContentPlaceholder",
												)}
												className="min-h-48 font-mono"
												variant="secondary"
											/>
											<Description>
												{t("skillContentHelp")}
											</Description>
											{fieldState.error && (
												<FieldError>
													{fieldState.error.message}
												</FieldError>
											)}
										</TextField>
									)}
								/>
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

						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="author"
									control={control}
									render={({ field }) => (
										<TextField className="w-full">
											<Label>{t("author")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"authorPlaceholder",
												)}
												variant="secondary"
											/>
										</TextField>
									)}
								/>
								<Controller
									name="toolsInput"
									control={control}
									render={({ field }) => (
										<TextField className="w-full">
											<Label>{t("requiredTools")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"toolsPlaceholder",
												)}
												variant="secondary"
											/>
											<Description>
												{t("csvToolsHelp")}
											</Description>
										</TextField>
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
									createMutation.isPending ||
									isSubmitting ||
									skillAgents.length === 0
								}
							>
								{createMutation.isPending
									? t("creating")
									: t("create")}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}

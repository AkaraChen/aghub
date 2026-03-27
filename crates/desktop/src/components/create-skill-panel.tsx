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
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type { CreateSkillRequest } from "../lib/api-types";
import { AgentSelector } from "./agent-selector";

interface CreateSkillPanelProps {
	onDone: () => void;
	projectPath?: string;
}

interface CreateSkillFormValues {
	name: string;
	description: string;
	author: string;
	toolsInput: string;
	selectedAgents: string[];
}

export function CreateSkillPanel({
	onDone,
	projectPath,
}: CreateSkillPanelProps) {
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
			toolsInput: "",
			selectedAgents: skillAgents[0] ? [skillAgents[0].id] : [],
		},
	});

	const invalidateCache = () => {
		queryClient.invalidateQueries({ queryKey: ["skills"] });
		queryClient.invalidateQueries({ queryKey: ["project-skills"] });
		queryClient.invalidateQueries({ queryKey: ["skill-locks"] });
	};

	const createMutation = useMutation({
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setError(errorMessage);
		},
		mutationFn: ({
			agent,
			body,
		}: {
			agent: string;
			body: CreateSkillRequest;
		}) => {
			return api.skills.create(agent, body, projectPath);
		},
		onSuccess: invalidateCache,
	});

	const handleCreate = async (values: CreateSkillFormValues) => {
		const tools = values.toolsInput
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);

		const body: CreateSkillRequest = {
			name: values.name.trim(),
			description: values.description.trim() || undefined,
			author: values.author.trim() || undefined,
			tools: tools.length > 0 ? tools : undefined,
		};

		try {
			await Promise.all(
				values.selectedAgents.map((agent) =>
					createMutation.mutateAsync({ agent, body }),
				),
			);
			onDone();
		} catch {
			// Error is handled by onError callback
		}
	};

	return (
		<div className="h-full max-w-3xl overflow-y-auto p-6">
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
									render={({ field }) => (
										<TextField className="w-full">
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
										</TextField>
									)}
								/>
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

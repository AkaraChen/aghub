import {
	Alert,
	Button,
	Card,
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
import type { SubAgentResponse } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import {
	supportsSubAgent,
	supportsSubAgentScope,
} from "../lib/agent-capabilities";
import { createSubAgentMutationOptions } from "../requests/sub-agents";
import { AgentSelector } from "./agent-selector";

interface CreateSubAgentPanelProps {
	onDone: (created?: SubAgentResponse) => void;
	projectPath?: string;
}

interface FormValues {
	selectedAgents: string[];
	name: string;
	description: string;
	instruction: string;
}

export function CreateSubAgentPanel({
	onDone,
	projectPath,
}: CreateSubAgentPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();
	const scope = projectPath ? "project" : "global";

	const capableAgents = useMemo(
		() =>
			availableAgents.filter(
				(a) =>
					a.isConfigurable &&
					supportsSubAgent(a) &&
					supportsSubAgentScope(a, scope),
			),
		[availableAgents, scope],
	);
	const detectedDefault = capableAgents.find((agent) => agent.isUsable);

	const [error, setError] = useState<string | null>(null);

	const createMutation = useMutation({
		...createSubAgentMutationOptions({
			api,
			queryClient,
		}),
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setError(errorMessage);
		},
	});

	const {
		control,
		handleSubmit,
		formState: { isSubmitting },
	} = useForm<FormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			selectedAgents: detectedDefault ? [detectedDefault.id] : [],
			name: "",
			description: "",
			instruction: "",
		},
	});

	const onSubmit = async (values: FormValues) => {
		setError(null);

		try {
			const results = await Promise.all(
				values.selectedAgents.map((agent) =>
					createMutation.mutateAsync({
						agent,
						scope,
						projectRoot: projectPath,
						body: {
							name: values.name.trim(),
							description: values.description.trim(),
							instruction: values.instruction.trim(),
						},
					}),
				),
			);
			onDone(results[0]);
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
						{t("createSubAgent")}
					</h2>
				</Card.Header>
				<Card.Content>
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(onSubmit)}
					>
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
											agents={capableAgents}
											selectedKeys={new Set(field.value)}
											onSelectionChange={(keys) =>
												field.onChange([...keys])
											}
											label={t("agents")}
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
									name="name"
									control={control}
									rules={{
										required: t("validationNameRequired"),
										validate: (v) =>
											v.trim()
												? true
												: t("validationNameRequired"),
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											variant="secondary"
											isRequired
											validationBehavior="aria"
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>{t("subAgentName")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"subAgentNamePlaceholder",
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
										validate: (v) =>
											v.trim()
												? true
												: t(
														"validationDescriptionRequired",
													),
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											variant="secondary"
											isRequired
											validationBehavior="aria"
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>
												{t("subAgentDescription")}
											</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"subAgentDescriptionPlaceholder",
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

						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="instruction"
									control={control}
									rules={{
										required: t(
											"validationInstructionRequired",
										),
										validate: (v) =>
											v.trim()
												? true
												: t(
														"validationInstructionRequired",
													),
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											variant="secondary"
											isRequired
											validationBehavior="aria"
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>
												{t("subAgentInstruction")}
											</Label>
											<TextArea
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t(
													"subAgentInstructionPlaceholder",
												)}
												variant="secondary"
												className="min-h-48"
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

						<div className="flex justify-end gap-2 pt-2">
							<Button
								type="button"
								variant="secondary"
								onPress={() => onDone()}
							>
								{t("cancel")}
							</Button>
							<Button
								type="submit"
								isDisabled={
									createMutation.isPending ||
									isSubmitting ||
									capableAgents.length === 0
								}
							>
								{createMutation.isPending
									? t("creating")
									: t("createSubAgent")}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>
		</div>
	);
}

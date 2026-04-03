import {
	Button,
	Card,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Select,
	TextArea,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import {
	supportsSubAgent,
	supportsSubAgentScope,
} from "../lib/agent-capabilities";
import { createSubAgentMutationOptions } from "../requests/sub-agents";

interface CreateSubAgentPanelProps {
	onDone: () => void;
	projectPath?: string;
}

interface FormValues {
	agentId: string;
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
					a.isUsable &&
					supportsSubAgent(a) &&
					supportsSubAgentScope(a, scope),
			),
		[availableAgents, scope],
	);

	const createMutation = useMutation(
		createSubAgentMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				onDone();
			},
		}),
	);

	const {
		control,
		handleSubmit,
		formState: { isSubmitting },
	} = useForm<FormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			agentId: capableAgents[0]?.id ?? "",
			name: "",
			description: "",
			instruction: "",
		},
	});

	const onSubmit = (values: FormValues) => {
		createMutation.mutate({
			agent: values.agentId,
			scope,
			projectRoot: projectPath,
			body: {
				name: values.name.trim(),
				description: values.description.trim(),
				instruction: values.instruction.trim(),
			},
		});
	};

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
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
									name="agentId"
									control={control}
									render={({ field }) => (
										<Select
											className="w-full"
											selectedKey={field.value}
											onSelectionChange={(key) =>
												field.onChange(key)
											}
											variant="secondary"
											isDisabled={
												capableAgents.length === 0
											}
										>
											<Label>
												{t("agentManagement")}
											</Label>
											<Select.Trigger>
												<Select.Value />
												<Select.Indicator />
											</Select.Trigger>
											<Select.Popover>
												<ListBox>
													{capableAgents.map((a) => (
														<ListBox.Item
															key={a.id}
															id={a.id}
															textValue={
																a.display_name
															}
														>
															{a.display_name}
														</ListBox.Item>
													))}
												</ListBox>
											</Select.Popover>
										</Select>
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
								onPress={onDone}
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

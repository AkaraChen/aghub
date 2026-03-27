import {
	Alert,
	Button,
	Card,
	Disclosure,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Select,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type { TransportDto } from "../lib/api-types";
import {
	getKeyPairErrorMessage,
	validateHttpUrl,
	validateKeyPairs,
	validatePositiveInteger,
} from "../lib/form-utils";
import { buildTransportFromForm } from "../lib/mcp-utils";
import { AgentSelector } from "./agent-selector";
import type { EnvVar } from "./env-editor";
import { EnvEditor } from "./env-editor";
import type { HttpHeader } from "./http-header-editor";
import { HttpHeaderEditor } from "./http-header-editor";

interface CreateMcpPanelProps {
	onDone: () => void;
	projectPath?: string;
}

interface CreateMcpFormValues {
	name: string;
	transportType: "stdio" | "sse" | "streamable_http";
	timeoutValue: string;
	selectedAgents: string[];
	command: string;
	args: string;
	envVars: EnvVar[];
	url: string;
	httpHeaders: HttpHeader[];
}

export function CreateMcpPanel({ onDone, projectPath }: CreateMcpPanelProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const usableAgents = useMemo(
		() => availableAgents.filter((a) => a.isUsable),
		[availableAgents],
	);

	const defaultAgents = usableAgents[0] ? [usableAgents[0].id] : [];

	const {
		control,
		handleSubmit,
		watch,
		formState: { submitCount, isSubmitting },
	} = useForm<CreateMcpFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			name: "",
			transportType: "stdio",
			timeoutValue: "",
			selectedAgents: defaultAgents,
			command: "",
			args: "",
			envVars: [],
			url: "",
			httpHeaders: [],
		},
	});

	const transportType = watch("transportType");
	const envVars = watch("envVars");
	const httpHeaders = watch("httpHeaders");

	const envErrors = useMemo(() => validateKeyPairs(t, envVars), [t, envVars]);
	const headerErrors = useMemo(
		() => validateKeyPairs(t, httpHeaders),
		[t, httpHeaders],
	);
	const hasPairErrors = useMemo(
		() =>
			envErrors.some((error) => error.key || error.value) ||
			headerErrors.some((error) => error.key || error.value),
		[envErrors, headerErrors],
	);
	const envErrorMessage = useMemo(
		() => getKeyPairErrorMessage(envErrors),
		[envErrors],
	);
	const headerErrorMessage = useMemo(
		() => getKeyPairErrorMessage(headerErrors),
		[headerErrors],
	);

	const createMutation = useMutation({
		onError: () => {
			// handled in submit catch for better message control
		},
		mutationFn: ({
			agent,
			body,
		}: {
			agent: string;
			body: { name: string; transport: TransportDto; timeout?: number };
		}) => {
			const scope = projectPath ? "project" : "global";
			return api.mcps.create(agent, scope, body, projectPath);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mcps"] });
			queryClient.invalidateQueries({ queryKey: ["project-mcps"] });
		},
	});

	const onSubmit = async (values: CreateMcpFormValues) => {
		if (hasPairErrors) return;

		const transport = buildTransportFromForm(values.transportType, {
			command: values.command,
			args: values.args,
			envVars: values.envVars,
			url: values.url,
			httpHeaders: values.httpHeaders,
			timeout: values.timeoutValue,
		});
		if (!transport) return;

		const body = {
			name: values.name.trim(),
			transport,
			timeout: values.timeoutValue
				? Number.parseInt(values.timeoutValue, 10)
				: undefined,
		};

		try {
			await Promise.all(
				values.selectedAgents.map((agent) =>
					createMutation.mutateAsync({ agent, body }),
				),
			);
			onDone();
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			throw new Error(errorMessage);
		}
	};

	return (
		<div className="h-full max-w-3xl overflow-y-auto p-6">
			{createMutation.error && (
				<Alert className="mb-4" status="danger">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Description>
							{t("createError", {
								error:
									createMutation.error instanceof Error
										? createMutation.error.message
										: String(createMutation.error),
							})}
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			<Card>
				<Card.Header>
					<h2 className="text-xl font-semibold text-foreground">
						{t("createMcpServer")}
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
									name="name"
									control={control}
									rules={{
										required: t("validationNameRequired"),
										validate: (value) =>
											value.trim()
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
											<Label>{t("name")}</Label>
											<Input
												value={field.value}
												onChange={(e) =>
													field.onChange(
														e.target.value,
													)
												}
												onBlur={field.onBlur}
												placeholder={t("serverName")}
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
									name="transportType"
									control={control}
									render={({ field }) => (
										<Select
											className="w-full"
											selectedKey={field.value}
											onSelectionChange={(key) =>
												field.onChange(
													key as
														| "stdio"
														| "sse"
														| "streamable_http",
												)
											}
											variant="secondary"
										>
											<Label>{t("transportType")}</Label>
											<Select.Trigger>
												<Select.Value />
												<Select.Indicator />
											</Select.Trigger>
											<Select.Popover>
												<ListBox>
													<ListBox.Item
														id="stdio"
														textValue="stdio"
													>
														stdio
													</ListBox.Item>
													<ListBox.Item
														id="sse"
														textValue="sse"
													>
														sse
													</ListBox.Item>
													<ListBox.Item
														id="streamable_http"
														textValue="streamable_http"
													>
														streamable_http
													</ListBox.Item>
												</ListBox>
											</Select.Popover>
										</Select>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						{transportType === "stdio" && (
							<Fieldset>
								<Fieldset.Group>
									<Controller
										name="command"
										control={control}
										rules={{
											validate: (value) =>
												transportType !== "stdio" ||
												value.trim()
													? true
													: t(
															"validationCommandRequired",
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
												<Label>{t("command")}</Label>
												<Input
													value={field.value}
													onChange={(e) =>
														field.onChange(
															e.target.value,
														)
													}
													onBlur={field.onBlur}
													placeholder="npx"
													variant="secondary"
												/>
												{fieldState.error && (
													<FieldError>
														{
															fieldState.error
																.message
														}
													</FieldError>
												)}
											</TextField>
										)}
									/>
									<Controller
										name="args"
										control={control}
										render={({ field }) => (
											<TextField
												className="w-full"
												variant="secondary"
											>
												<Label>{t("args")}</Label>
												<Input
													value={field.value}
													onChange={(e) =>
														field.onChange(
															e.target.value,
														)
													}
													onBlur={field.onBlur}
													placeholder="-y @modelcontextprotocol/server-filesystem"
													variant="secondary"
												/>
											</TextField>
										)}
									/>
									<Controller
										name="envVars"
										control={control}
										render={({ field }) => (
											<div className="flex flex-col gap-2">
												<Label>{t("env")}</Label>
												<EnvEditor
													value={field.value}
													onChange={field.onChange}
													variant="secondary"
													errors={
														submitCount > 0
															? envErrors
															: undefined
													}
													errorMessage={
														submitCount > 0
															? envErrorMessage
															: undefined
													}
												/>
											</div>
										)}
									/>
								</Fieldset.Group>
							</Fieldset>
						)}

						{(transportType === "sse" ||
							transportType === "streamable_http") && (
							<Fieldset>
								<Fieldset.Group>
									<Controller
										name="url"
										control={control}
										rules={{
											validate: (value) =>
												validateHttpUrl(value, t),
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
												<Label>URL</Label>
												<Input
													value={field.value}
													onChange={(e) =>
														field.onChange(
															e.target.value,
														)
													}
													onBlur={field.onBlur}
													placeholder="http://localhost:3000/sse"
													variant="secondary"
												/>
												{fieldState.error && (
													<FieldError>
														{
															fieldState.error
																.message
														}
													</FieldError>
												)}
											</TextField>
										)}
									/>
									<Controller
										name="httpHeaders"
										control={control}
										render={({ field }) => (
											<div className="flex flex-col gap-2">
												<Label>{t("headers")}</Label>
												<HttpHeaderEditor
													value={field.value}
													onChange={field.onChange}
													variant="secondary"
													errors={
														submitCount > 0
															? headerErrors
															: undefined
													}
													errorMessage={
														submitCount > 0
															? headerErrorMessage
															: undefined
													}
												/>
											</div>
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
											agents={usableAgents}
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

						<Disclosure className="pt-4">
							<Disclosure.Trigger className="flex w-full items-center justify-between">
								{t("advanced")}
								<Disclosure.Indicator />
							</Disclosure.Trigger>
							<Disclosure.Content>
								<Fieldset>
									<Fieldset.Group>
										<Controller
											name="timeoutValue"
											control={control}
											rules={{
												validate: (value) =>
													validatePositiveInteger(
														value,
														t,
													),
											}}
											render={({ field, fieldState }) => (
												<TextField
													className="w-full"
													variant="secondary"
													validationBehavior="aria"
													isInvalid={Boolean(
														fieldState.error,
													)}
												>
													<Label>
														{t("timeout")}
													</Label>
													<Input
														type="number"
														value={field.value}
														onChange={(e) =>
															field.onChange(
																e.target.value,
															)
														}
														onBlur={field.onBlur}
														placeholder="60"
														variant="secondary"
													/>
													{fieldState.error && (
														<FieldError>
															{
																fieldState.error
																	.message
															}
														</FieldError>
													)}
												</TextField>
											)}
										/>
									</Fieldset.Group>
								</Fieldset>
							</Disclosure.Content>
						</Disclosure>

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
									usableAgents.length === 0
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

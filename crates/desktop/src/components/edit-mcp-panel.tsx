import {
	Alert,
	Button,
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
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useApi } from "../hooks/use-api";
import type { UpdateMcpRequest } from "../lib/api";
import type { McpResponse } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import {
	getKeyPairErrorMessage,
	validateHttpUrl,
	validateKeyPairs,
	validatePositiveInteger,
} from "../lib/form-utils";
import { objectToKeyPairs } from "../lib/key-pair-utils";
import { buildTransportFromForm, capitalize } from "../lib/mcp-utils";
import { getMcpMergeKey } from "../lib/utils";
import { invalidateMcpQueries } from "../requests/mcps";
import type { EnvVar } from "./env-editor";
import { EnvEditor } from "./env-editor";
import type { HttpHeader } from "./http-header-editor";
import { HttpHeaderEditor } from "./http-header-editor";

interface EditMcpPanelProps {
	group: {
		mergeKey: string;
		transport: McpResponse["transport"];
		items: McpResponse[];
	};
	onDone: (mergeKey: string) => void;
	projectPath?: string;
}

interface EditMcpFormValues {
	name: string;
	transportType: "stdio" | "sse" | "streamable_http";
	timeoutValue: string;
	command: string;
	args: string;
	envVars: EnvVar[];
	url: string;
	httpHeaders: HttpHeader[];
}

export function EditMcpPanel({
	group,
	onDone,
	projectPath,
}: EditMcpPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const primaryServer = group.items[0];

	const {
		control,
		handleSubmit,
		formState: { submitCount, isSubmitting },
	} = useForm<EditMcpFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			name: primaryServer.name,
			transportType: primaryServer.transport.type,
			timeoutValue: primaryServer.timeout?.toString() ?? "",
			command:
				primaryServer.transport.type === "stdio"
					? primaryServer.transport.command
					: "",
			args:
				primaryServer.transport.type === "stdio" &&
				primaryServer.transport.args
					? primaryServer.transport.args.join(" ")
					: "",
			envVars:
				primaryServer.transport.type === "stdio" &&
				primaryServer.transport.env
					? objectToKeyPairs(primaryServer.transport.env)
					: [],
			url:
				primaryServer.transport.type !== "stdio"
					? primaryServer.transport.url
					: "",
			httpHeaders:
				primaryServer.transport.type !== "stdio" &&
				primaryServer.transport.headers
					? objectToKeyPairs(primaryServer.transport.headers)
					: [],
		},
	});

	const transportType = useWatch({ control, name: "transportType" });
	const envVars = useWatch({ control, name: "envVars" });
	const httpHeaders = useWatch({ control, name: "httpHeaders" });
	const urlPlaceholder =
		transportType === "sse"
			? "http://localhost:3000/sse"
			: "http://localhost:3000/mcp";

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

	const updateMutation = useMutation({
		mutationFn: async (body: UpdateMcpRequest) => {
			return Promise.all(
				group.items.map((item) => {
					const scope =
						item.source === ConfigSource.Project
							? "project"
							: "global";
					return api.mcps.update(
						item.name,
						item.agent ?? "default",
						scope,
						body,
						projectPath,
					);
				}),
			);
		},
		onSuccess: async (_data, body) => {
			await invalidateMcpQueries(queryClient);
			onDone(getMcpMergeKey(body.transport ?? primaryServer.transport));
		},
		onError: () => {
			// handled in render
		},
	});

	const agentNamesList = useMemo(
		() =>
			group.items
				.map((i) => (i.agent ? capitalize(i.agent) : "Default"))
				.join(", "),
		[group.items],
	);

	const onSubmit = async (values: EditMcpFormValues) => {
		if (hasPairErrors) return;

		const body: UpdateMcpRequest = {
			name:
				values.name.trim() !== primaryServer.name
					? values.name.trim()
					: undefined,
			timeout: values.timeoutValue
				? Number.parseInt(values.timeoutValue, 10)
				: undefined,
		};

		const transport = buildTransportFromForm(values.transportType, {
			command: values.command,
			args: values.args,
			envVars: values.envVars,
			url: values.url,
			httpHeaders: values.httpHeaders,
			timeout: values.timeoutValue,
		});
		if (transport) {
			body.transport = transport;
		}

		await updateMutation.mutateAsync(body);
	};

	return (
		<div className="h-full w-full overflow-y-auto p-4 sm:p-6">
			<div className="mb-6 flex items-center justify-between gap-3">
				<h2 className="text-xl font-semibold text-foreground">
					{t("editMcpServer")}
				</h2>
			</div>

			{group.items.length > 1 && (
				<Alert className="mb-4" status="warning">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Title>{t("multipleAgents")}</Alert.Title>
						<Alert.Description>
							{t("changeWillApplyToAgents", {
								count: group.items.length,
								agents: agentNamesList,
							})}
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			{updateMutation.error && (
				<Alert className="mb-4" status="danger">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Description>
							{t("saveError", {
								error:
									updateMutation.error instanceof Error
										? updateMutation.error.message
										: String(updateMutation.error),
							})}
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			<Form validationBehavior="aria" onSubmit={handleSubmit(onSubmit)}>
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
									isRequired
									validationBehavior="aria"
									isInvalid={Boolean(fieldState.error)}
								>
									<Label>{t("name")}</Label>
									<Input
										value={field.value}
										onChange={(e) =>
											field.onChange(e.target.value)
										}
										onBlur={field.onBlur}
										placeholder={t("serverName")}
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
											: t("validationCommandRequired"),
								}}
								render={({ field, fieldState }) => (
									<TextField
										className="w-full"
										isRequired
										validationBehavior="aria"
										isInvalid={Boolean(fieldState.error)}
									>
										<Label>{t("command")}</Label>
										<Input
											value={field.value}
											onChange={(e) =>
												field.onChange(e.target.value)
											}
											onBlur={field.onBlur}
											placeholder="npx"
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
								name="args"
								control={control}
								render={({ field }) => (
									<TextField className="w-full">
										<Label>{t("args")}</Label>
										<Input
											value={field.value}
											onChange={(e) =>
												field.onChange(e.target.value)
											}
											onBlur={field.onBlur}
											placeholder="-y @modelcontextprotocol/server-filesystem"
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
										isRequired
										validationBehavior="aria"
										isInvalid={Boolean(fieldState.error)}
									>
										<Label>URL</Label>
										<Input
											value={field.value}
											onChange={(e) =>
												field.onChange(e.target.value)
											}
											onBlur={field.onBlur}
											placeholder={urlPlaceholder}
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
								name="httpHeaders"
								control={control}
								render={({ field }) => (
									<div className="flex flex-col gap-2">
										<Label>{t("headers")}</Label>
										<HttpHeaderEditor
											value={field.value}
											onChange={field.onChange}
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

				<Disclosure className="mb-6 pt-4">
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
											validatePositiveInteger(value, t),
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											validationBehavior="aria"
											isInvalid={Boolean(
												fieldState.error,
											)}
										>
											<Label>{t("timeout")}</Label>
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
					</Disclosure.Content>
				</Disclosure>

				<div className="flex justify-end gap-2 pt-2">
					<Button
						type="button"
						variant="secondary"
						onPress={() => onDone(group.mergeKey)}
					>
						{t("cancel")}
					</Button>
					<Button
						type="submit"
						isDisabled={updateMutation.isPending || isSubmitting}
					>
						{updateMutation.isPending ? t("saving") : t("save")}
					</Button>
				</div>
			</Form>
		</div>
	);
}

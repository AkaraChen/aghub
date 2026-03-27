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
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useServer } from "../hooks/use-server";
import type { UpdateMcpRequest } from "../lib/api";
import { createApi } from "../lib/api";
import type { McpResponse } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { objectToKeyPairs } from "../lib/key-pair-utils";
import { buildTransportFromForm, capitalize } from "../lib/mcp-utils";
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
	onDone: () => void;
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

function validateKeyPairs(
	t: ReturnType<typeof useTranslation>["t"],
	pairs: Array<{ key: string; value: string }>,
): Array<{ key?: string; value?: string }> {
	const errors: Array<{ key?: string; value?: string }> = pairs.map(
		() => ({}),
	);
	const seenKeys = new Map<string, number[]>();

	pairs.forEach((pair, index) => {
		const key = pair.key.trim();
		const value = pair.value.trim();

		if (!key && !value) return;
		if (!key) {
			errors[index].key = t("validationKeyRequired");
			return;
		}
		if (!value) {
			errors[index].value = t("validationValueRequired");
			return;
		}

		const existing = seenKeys.get(key) ?? [];
		existing.push(index);
		seenKeys.set(key, existing);
	});

	for (const indices of seenKeys.values()) {
		if (indices.length < 2) continue;
		for (const index of indices) {
			errors[index].key = t("validationDuplicateKey");
		}
	}

	return errors;
}

function getKeyPairErrorMessage(
	errors: Array<{ key?: string; value?: string }>,
): string | undefined {
	for (const error of errors) {
		if (error.key) return error.key;
		if (error.value) return error.value;
	}

	return undefined;
}

export function EditMcpPanel({
	group,
	onDone,
	projectPath,
}: EditMcpPanelProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const primaryServer = group.items[0];

	const {
		control,
		handleSubmit,
		watch,
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

	const updateMutation = useMutation({
		mutationFn: (body: UpdateMcpRequest) => {
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
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mcps"] });
			queryClient.invalidateQueries({ queryKey: ["project-mcps"] });
			onDone();
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
		<div className="h-full max-w-3xl overflow-y-auto p-6">
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
									validate: (value) => {
										if (!value.trim()) {
											return t("validationUrlRequired");
										}
										try {
											const parsed = new URL(value);
											if (
												parsed.protocol !== "http:" &&
												parsed.protocol !== "https:"
											) {
												return t(
													"validationUrlProtocol",
												);
											}
										} catch {
											return t("validationUrlInvalid");
										}
										return true;
									},
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
											placeholder="http://localhost:3000/sse"
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
										validate: (value) => {
											if (!value.trim()) {
												return true;
											}
											if (!/^\d+$/.test(value)) {
												return t(
													"validationTimeoutPositiveInteger",
												);
											}
											return Number.parseInt(value, 10) >
												0
												? true
												: t(
														"validationTimeoutPositiveInteger",
													);
										},
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
					<Button type="button" variant="secondary" onPress={onDone}>
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

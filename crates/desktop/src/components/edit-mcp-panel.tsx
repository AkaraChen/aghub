import {
	Alert,
	Button,
	Description,
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
import type { ChangeEvent, FormEvent, Key } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServer } from "../hooks/use-server";
import type { UpdateMcpRequest } from "../lib/api";
import { createApi } from "../lib/api";
import type { McpResponse, TransportDto } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { objectToKeyPairs } from "../lib/key-pair-utils";
import {
	hasMcpFormErrors,
	type McpFormErrors,
	validateCommand,
	validateMcpForm,
	validateName,
	validateTimeout,
	validateUrl,
} from "../lib/mcp-form-validation";
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

	const [name, setName] = useState(primaryServer.name);
	const [transportType, setTransportType] = useState<
		"stdio" | "sse" | "streamable_http"
	>(primaryServer.transport.type);
	const [timeoutValue, setTimeoutValue] = useState(
		primaryServer.timeout?.toString() ?? "",
	);

	const [command, setCommand] = useState(
		primaryServer.transport.type === "stdio"
			? primaryServer.transport.command
			: "",
	);
	const [args, setArgs] = useState(
		primaryServer.transport.type === "stdio" && primaryServer.transport.args
			? primaryServer.transport.args.join(" ")
			: "",
	);
	const [envVars, setEnvVars] = useState<EnvVar[]>(() => {
		if (
			primaryServer.transport.type === "stdio" &&
			primaryServer.transport.env
		) {
			return objectToKeyPairs(primaryServer.transport.env);
		}
		return [];
	});

	const [url, setUrl] = useState(
		primaryServer.transport.type !== "stdio"
			? primaryServer.transport.url
			: "",
	);
	const [httpHeaders, setHttpHeaders] = useState<HttpHeader[]>(() => {
		if (
			primaryServer.transport.type !== "stdio" &&
			primaryServer.transport.headers
		) {
			return objectToKeyPairs(primaryServer.transport.headers);
		}
		return [];
	});
	const [error, setError] = useState<string | null>(null);
	const [validationErrors, setValidationErrors] = useState(() =>
		validateMcpForm(t, {
			name: primaryServer.name,
			transportType: primaryServer.transport.type,
			command:
				primaryServer.transport.type === "stdio"
					? primaryServer.transport.command
					: "",
			url:
				primaryServer.transport.type !== "stdio"
					? primaryServer.transport.url
					: "",
			timeoutValue: primaryServer.timeout?.toString() ?? "",
			envVars:
				primaryServer.transport.type === "stdio" &&
				primaryServer.transport.env
					? objectToKeyPairs(primaryServer.transport.env)
					: [],
			httpHeaders:
				primaryServer.transport.type !== "stdio" &&
				primaryServer.transport.headers
					? objectToKeyPairs(primaryServer.transport.headers)
					: [],
		}),
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
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setError(errorMessage);
			console.error("Failed to update MCP servers:", error);
		},
	});

	const agentNamesList = useMemo(
		() =>
			group.items
				.map((i) => (i.agent ? capitalize(i.agent) : "Default"))
				.join(", "),
		[group.items],
	);

	const buildTransport = (): TransportDto | undefined => {
		return buildTransportFromForm(transportType, {
			command,
			args,
			envVars,
			url,
			httpHeaders,
			timeout: timeoutValue,
		});
	};

	const handleSave = () => {
		const nextErrors = validateMcpForm(t, {
			name,
			transportType,
			command,
			url,
			timeoutValue,
			envVars,
			httpHeaders,
		});
		setValidationErrors(nextErrors);
		if (hasMcpFormErrors(nextErrors)) return;

		const body: UpdateMcpRequest = {
			name: name.trim() !== primaryServer.name ? name.trim() : undefined,
			timeout: timeoutValue
				? Number.parseInt(timeoutValue, 10)
				: undefined,
		};

		const transport = buildTransport();
		if (transport) {
			body.transport = transport;
		}

		updateMutation.mutate(body);
	};

	const isValid = useMemo(() => {
		return !hasMcpFormErrors(
			validateMcpForm(t, {
				name,
				transportType,
				command,
				url,
				timeoutValue,
				envVars,
				httpHeaders,
			}),
		);
	}, [
		t,
		name,
		transportType,
		command,
		url,
		timeoutValue,
		envVars,
		httpHeaders,
	]);

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

			{error && (
				<Alert className="mb-4" status="danger">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Description>
							{t("saveError", { error })}
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			<Form
				validationBehavior="aria"
				onSubmit={(e: FormEvent<HTMLFormElement>) => {
					e.preventDefault();
					handleSave();
				}}
			>
				<Fieldset>
					<Fieldset.Group>
						<TextField
							className="w-full"
							isRequired
							isInvalid={Boolean(validationErrors.name)}
						>
							<Label>{t("name")}</Label>
							<Input
								value={name}
								onChange={(
									e: ChangeEvent<HTMLInputElement>,
								) => {
									const value = e.target.value;
									setName(value);
									setValidationErrors(
										(current: McpFormErrors) => ({
											...current,
											name: validateName(t, value),
										}),
									);
								}}
								placeholder={t("serverName")}
							/>
							<FieldError>{validationErrors.name}</FieldError>
						</TextField>
					</Fieldset.Group>
				</Fieldset>

				<Fieldset>
					<Fieldset.Group>
						<Select
							className="w-full"
							selectedKey={transportType}
							onSelectionChange={(key: Key | null) => {
								const nextType = key as
									| "stdio"
									| "sse"
									| "streamable_http";
								setTransportType(nextType);
								setValidationErrors(
									(current: McpFormErrors) => ({
										...current,
										command: validateCommand(
											t,
											nextType,
											command,
										),
										url: validateUrl(t, nextType, url),
									}),
								);
							}}
						>
							<Label>{t("transportType")}</Label>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									<ListBox.Item id="stdio" textValue="stdio">
										stdio
									</ListBox.Item>
									<ListBox.Item id="sse" textValue="sse">
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
					</Fieldset.Group>
				</Fieldset>

				{transportType === "stdio" && (
					<Fieldset>
						<Fieldset.Group>
							<TextField
								className="w-full"
								isRequired
								isInvalid={Boolean(validationErrors.command)}
							>
								<Label>{t("command")}</Label>
								<Input
									value={command}
									onChange={(
										e: ChangeEvent<HTMLInputElement>,
									) => {
										const value = e.target.value;
										setCommand(value);
										setValidationErrors(
											(current: McpFormErrors) => ({
												...current,
												command: validateCommand(
													t,
													transportType,
													value,
												),
											}),
										);
									}}
									placeholder="npx"
								/>
								<FieldError>
									{validationErrors.command}
								</FieldError>
							</TextField>
							<TextField className="w-full">
								<Label>{t("args")}</Label>
								<Input
									value={args}
									onChange={(e) => setArgs(e.target.value)}
									placeholder="-y @modelcontextprotocol/server-filesystem"
								/>
								<Description>{t("argsHelp")}</Description>
							</TextField>
							<div className="flex flex-col gap-2">
								<Label>{t("env")}</Label>
								<EnvEditor
									value={envVars}
									onChange={(value) => {
										setEnvVars(value);
										setValidationErrors(
											(current: McpFormErrors) => ({
												...current,
												envVars: validateMcpForm(t, {
													name,
													transportType,
													command,
													url,
													timeoutValue,
													envVars: value,
													httpHeaders,
												}).envVars,
											}),
										);
									}}
									errors={validationErrors.envVars}
								/>
							</div>
						</Fieldset.Group>
					</Fieldset>
				)}

				{(transportType === "sse" ||
					transportType === "streamable_http") && (
					<Fieldset>
						<Fieldset.Group>
							<TextField
								className="w-full"
								isRequired
								isInvalid={Boolean(validationErrors.url)}
							>
								<Label>URL</Label>
								<Input
									value={url}
									onChange={(
										e: ChangeEvent<HTMLInputElement>,
									) => {
										const value = e.target.value;
										setUrl(value);
										setValidationErrors(
											(current: McpFormErrors) => ({
												...current,
												url: validateUrl(
													t,
													transportType,
													value,
												),
											}),
										);
									}}
									placeholder="http://localhost:3000/sse"
								/>
								<FieldError>{validationErrors.url}</FieldError>
							</TextField>
							<div className="flex flex-col gap-2">
								<Label>{t("headers")}</Label>
								<HttpHeaderEditor
									value={httpHeaders}
									onChange={(value) => {
										setHttpHeaders(value);
										setValidationErrors(
											(current: McpFormErrors) => ({
												...current,
												httpHeaders: validateMcpForm(
													t,
													{
														name,
														transportType,
														command,
														url,
														timeoutValue,
														envVars,
														httpHeaders: value,
													},
												).httpHeaders,
											}),
										);
									}}
									errors={validationErrors.httpHeaders}
								/>
							</div>
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
								<TextField
									className="w-full"
									isInvalid={Boolean(
										validationErrors.timeout,
									)}
								>
									<Label>{t("timeout")}</Label>
									<Input
										type="number"
										value={timeoutValue}
										onChange={(
											e: ChangeEvent<HTMLInputElement>,
										) => {
											const value = e.target.value;
											setTimeoutValue(value);
											setValidationErrors(
												(current: McpFormErrors) => ({
													...current,
													timeout: validateTimeout(
														t,
														value,
													),
												}),
											);
										}}
										placeholder="60"
									/>
									<Description>
										{t("timeoutHelp")}
									</Description>
									<FieldError>
										{validationErrors.timeout}
									</FieldError>
								</TextField>
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
						isDisabled={!isValid || updateMutation.isPending}
					>
						{updateMutation.isPending ? t("saving") : t("save")}
					</Button>
				</div>
			</Form>
		</div>
	);
}

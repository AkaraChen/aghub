import {
	Alert,
	Button,
	Card,
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
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type { TransportDto } from "../lib/api-types";
import {
	hasMcpFormErrors,
	type McpFormErrors,
	validateCommand,
	validateMcpForm,
	validateName,
	validateTimeout,
	validateUrl,
} from "../lib/mcp-form-validation";
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

	const [name, setName] = useState("");
	const [transportType, setTransportType] = useState<
		"stdio" | "sse" | "streamable_http"
	>("stdio");
	const [timeoutValue, setTimeoutValue] = useState("");
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(() => {
		return new Set(usableAgents[0] ? [usableAgents[0].id] : []);
	});

	const [command, setCommand] = useState("");
	const [args, setArgs] = useState("");
	const [envVars, setEnvVars] = useState<EnvVar[]>([]);

	const [url, setUrl] = useState("");
	const [httpHeaders, setHttpHeaders] = useState<HttpHeader[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [validationErrors, setValidationErrors] = useState(() =>
		validateMcpForm(t, {
			name: "",
			transportType: "stdio",
			command: "",
			url: "",
			timeoutValue: "",
			selectedAgents,
			envVars: [],
			httpHeaders: [],
		}),
	);

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

	const handleCreate = async () => {
		const nextErrors = validateMcpForm(t, {
			name,
			transportType,
			command,
			url,
			timeoutValue,
			selectedAgents,
			envVars,
			httpHeaders,
		});
		setValidationErrors(nextErrors);
		if (hasMcpFormErrors(nextErrors)) return;

		const transport = buildTransport();
		if (!transport) return;

		const body = {
			name: name.trim(),
			transport,
			timeout: timeoutValue
				? Number.parseInt(timeoutValue, 10)
				: undefined,
		};

		// Create MCP for each selected agent
		const agentsToCreate = [...selectedAgents];
		try {
			await Promise.all(
				agentsToCreate.map((agent) =>
					createMutation.mutateAsync({ agent, body }),
				),
			);
			onDone();
		} catch {
			// Error is handled by onError callback
		}
	};

	const isValid = useMemo(() => {
		if (usableAgents.length === 0) return false;
		return !hasMcpFormErrors(
			validateMcpForm(t, {
				name,
				transportType,
				command,
				url,
				timeoutValue,
				selectedAgents,
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
		selectedAgents,
		envVars,
		httpHeaders,
		usableAgents.length,
	]);

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
						{t("createMcpServer")}
					</h2>
				</Card.Header>

				<Card.Content>
					<Form
						validationBehavior="aria"
						onSubmit={(e: FormEvent<HTMLFormElement>) => {
							e.preventDefault();
							void handleCreate();
						}}
					>
						<Fieldset>
							<Fieldset.Group>
								<TextField
									className="w-full"
									variant="secondary"
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
													name: validateName(
														t,
														value,
													),
												}),
											);
										}}
										placeholder={t("serverName")}
										variant="secondary"
									/>
									<FieldError>
										{validationErrors.name}
									</FieldError>
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
												url: validateUrl(
													t,
													nextType,
													url,
												),
											}),
										);
									}}
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
							</Fieldset.Group>
						</Fieldset>

						{transportType === "stdio" && (
							<Fieldset>
								<Fieldset.Group>
									<TextField
										className="w-full"
										variant="secondary"
										isRequired
										isInvalid={Boolean(
											validationErrors.command,
										)}
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
													(
														current: McpFormErrors,
													) => ({
														...current,
														command:
															validateCommand(
																t,
																transportType,
																value,
															),
													}),
												);
											}}
											placeholder="npx"
											variant="secondary"
										/>
										<FieldError>
											{validationErrors.command}
										</FieldError>
									</TextField>
									<TextField
										className="w-full"
										variant="secondary"
									>
										<Label>{t("args")}</Label>
										<Input
											value={args}
											onChange={(e) =>
												setArgs(e.target.value)
											}
											placeholder="-y @modelcontextprotocol/server-filesystem"
											variant="secondary"
										/>
										<Description>
											{t("argsHelp")}
										</Description>
									</TextField>
									<div className="flex flex-col gap-2">
										<Label>{t("env")}</Label>
										<EnvEditor
											value={envVars}
											onChange={(value) => {
												setEnvVars(value);
												setValidationErrors(
													(
														current: McpFormErrors,
													) => ({
														...current,
														envVars:
															validateMcpForm(t, {
																name,
																transportType,
																command,
																url,
																timeoutValue,
																selectedAgents,
																envVars: value,
																httpHeaders,
															}).envVars,
													}),
												);
											}}
											variant="secondary"
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
										variant="secondary"
										isRequired
										isInvalid={Boolean(
											validationErrors.url,
										)}
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
													(
														current: McpFormErrors,
													) => ({
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
											variant="secondary"
										/>
										<FieldError>
											{validationErrors.url}
										</FieldError>
									</TextField>
									<div className="flex flex-col gap-2">
										<Label>{t("headers")}</Label>
										<HttpHeaderEditor
											value={httpHeaders}
											onChange={(value) => {
												setHttpHeaders(value);
												setValidationErrors(
													(
														current: McpFormErrors,
													) => ({
														...current,
														httpHeaders:
															validateMcpForm(t, {
																name,
																transportType,
																command,
																url,
																timeoutValue,
																selectedAgents,
																envVars,
																httpHeaders:
																	value,
															}).httpHeaders,
													}),
												);
											}}
											variant="secondary"
											errors={
												validationErrors.httpHeaders
											}
										/>
									</div>
								</Fieldset.Group>
							</Fieldset>
						)}

						<Fieldset>
							<Fieldset.Group>
								<AgentSelector
									agents={usableAgents}
									selectedKeys={selectedAgents}
									onSelectionChange={(keys) => {
										setSelectedAgents(keys);
										setValidationErrors(
											(current: McpFormErrors) => ({
												...current,
												agents:
													keys.size === 0
														? t(
																"validationAgentsRequired",
															)
														: undefined,
											}),
										);
									}}
									label={t("agents")}
									emptyMessage={t("noAgentsAvailable")}
									emptyHelpText={t("noAgentsAvailableHelp")}
									variant="secondary"
									errorMessage={validationErrors.agents}
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
										<TextField
											className="w-full"
											variant="secondary"
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
													const value =
														e.target.value;
													setTimeoutValue(value);
													setValidationErrors(
														(
															current: McpFormErrors,
														) => ({
															...current,
															timeout:
																validateTimeout(
																	t,
																	value,
																),
														}),
													);
												}}
												placeholder="60"
												variant="secondary"
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

						{/* Actions */}
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
									!isValid || createMutation.isPending
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

import {
	Alert,
	Button,
	Card,
	Description,
	FieldError,
	Fieldset,
	Form,
	Label,
	Modal,
	TextArea,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useReducer, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { supportsMcp } from "../lib/agent-capabilities";
import type { TransportDto } from "../lib/api-types";
import { createMcpMutationOptions } from "../requests/mcps";
import { AgentSelector } from "./agent-selector";

interface ImportMcpPanelProps {
	onDone: () => void;
	projectPath?: string;
}

interface McpServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	timeout?: number;
}

interface McpConfigJson {
	mcpServers?: Record<string, McpServerConfig>;
}

interface ImportMcpFormValues {
	jsonText: string;
}

interface ImportMcpUiState {
	parseError: string;
	parsedConfig: {
		name: string;
		config: McpServerConfig;
		transportType: "stdio" | "sse" | "streamable_http";
	} | null;
	showConfirmDialog: boolean;
	selectedAgents: Set<string>;
	confirmError: string;
}

type ImportMcpUiAction =
	| { type: "clear_parse_error" }
	| { type: "reset_parse" }
	| { type: "set_parse_error"; value: string }
	| {
			type: "open_confirm";
			parsedConfig: NonNullable<ImportMcpUiState["parsedConfig"]>;
	  }
	| { type: "set_confirm_open"; value: boolean }
	| { type: "set_selected_agents"; value: Set<string> }
	| { type: "set_confirm_error"; value: string };

function createImportUiState(defaultAgentIds: string[]): ImportMcpUiState {
	return {
		parseError: "",
		parsedConfig: null,
		showConfirmDialog: false,
		selectedAgents: new Set(defaultAgentIds),
		confirmError: "",
	};
}

function importUiReducer(
	state: ImportMcpUiState,
	action: ImportMcpUiAction,
): ImportMcpUiState {
	switch (action.type) {
		case "clear_parse_error":
			return { ...state, parseError: "" };
		case "reset_parse":
			return {
				...state,
				parseError: "",
				parsedConfig: null,
			};
		case "set_parse_error":
			return {
				...state,
				parseError: action.value,
				parsedConfig: null,
			};
		case "open_confirm":
			return {
				...state,
				parsedConfig: action.parsedConfig,
				confirmError: "",
				showConfirmDialog: true,
			};
		case "set_confirm_open":
			return { ...state, showConfirmDialog: action.value };
		case "set_selected_agents":
			return {
				...state,
				selectedAgents: action.value,
				confirmError: action.value.size > 0 ? "" : state.confirmError,
			};
		case "set_confirm_error":
			return { ...state, confirmError: action.value };
	}
}

export function ImportMcpPanel({ onDone, projectPath }: ImportMcpPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const usableAgents = useMemo(
		() => availableAgents.filter((a) => a.isUsable && supportsMcp(a)),
		[availableAgents],
	);
	const defaultAgentIds = useMemo(
		() => (usableAgents[0] ? [usableAgents[0].id] : []),
		[usableAgents],
	);

	const [error, setError] = useState<string | null>(null);
	const [uiState, dispatch] = useReducer(
		importUiReducer,
		defaultAgentIds,
		createImportUiState,
	);

	const {
		control,
		handleSubmit,
		reset,
		formState: { isSubmitting },
	} = useForm<ImportMcpFormValues>({
		mode: "onSubmit",
		reValidateMode: "onChange",
		defaultValues: {
			jsonText: "",
		},
	});

	const createMutation = useMutation({
		...createMcpMutationOptions({
			api,
			queryClient,
		}),
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setError(errorMessage);
		},
	});

	const handleParseJson = ({ jsonText }: ImportMcpFormValues) => {
		dispatch({ type: "reset_parse" });
		setError(null);

		try {
			const parsed: McpConfigJson = JSON.parse(jsonText);

			if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
				dispatch({
					type: "set_parse_error",
					value: t("parseError"),
				});
				return;
			}

			const serverNames = Object.keys(parsed.mcpServers);
			if (serverNames.length === 0) {
				dispatch({
					type: "set_parse_error",
					value: t("parseError"),
				});
				return;
			}

			const serverName = serverNames[0];
			const config = parsed.mcpServers[serverName];

			// Determine transport type
			let transportType: "stdio" | "sse" | "streamable_http";
			if (config.command) {
				transportType = "stdio";
			} else if (config.url) {
				transportType = "sse";
			} else {
				dispatch({
					type: "set_parse_error",
					value: t("parseError"),
				});
				return;
			}

			dispatch({
				type: "open_confirm",
				parsedConfig: { name: serverName, config, transportType },
			});
		} catch {
			dispatch({
				type: "set_parse_error",
				value: t("invalidJson"),
			});
		}
	};

	const handleConfirmImport = async () => {
		if (!uiState.parsedConfig) return;
		if (uiState.selectedAgents.size === 0) {
			dispatch({
				type: "set_confirm_error",
				value: t("validationAgentsRequired"),
			});
			return;
		}
		dispatch({ type: "set_confirm_error", value: "" });

		const { name, config, transportType } = uiState.parsedConfig;

		// Build transport
		let transport: TransportDto;
		if (transportType === "stdio") {
			transport = {
				type: "stdio",
				command: config.command || "",
				args: config.args,
				env: config.env,
			};
		} else {
			transport = {
				type: transportType,
				url: config.url || "",
				headers: config.headers,
			};
		}

		const body = {
			name,
			transport,
			timeout: config.timeout,
		};

		try {
			await Promise.all(
				Array.from(uiState.selectedAgents).map((agent) =>
					createMutation.mutateAsync({
						agent,
						scope: projectPath ? "project" : "global",
						body,
						projectRoot: projectPath,
					}),
				),
			);
			dispatch({ type: "set_confirm_open", value: false });
			reset();
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
						{t("importFromJson")}
					</h2>
				</Card.Header>

				<Card.Content>
					<Form
						validationBehavior="aria"
						onSubmit={handleSubmit(handleParseJson)}
					>
						<Fieldset>
							<Fieldset.Group>
								<Controller
									name="jsonText"
									control={control}
									rules={{
										required: t("validationJsonRequired"),
										validate: (value) =>
											value.trim()
												? true
												: t("validationJsonRequired"),
									}}
									render={({ field, fieldState }) => (
										<TextField
											className="w-full"
											variant="secondary"
											isRequired
											validationBehavior="aria"
											isInvalid={
												Boolean(fieldState.error) ||
												Boolean(uiState.parseError)
											}
										>
											<Label>{t("jsonConfig")}</Label>
											<TextArea
												value={field.value}
												onChange={(e) => {
													field.onChange(
														e.target.value,
													);
													if (uiState.parseError) {
														dispatch({
															type: "clear_parse_error",
														});
													}
												}}
												onBlur={field.onBlur}
												placeholder={t(
													"jsonConfigPlaceholder",
												)}
												className="min-h-75 font-mono text-sm"
												variant="secondary"
											/>
											<Description>
												{t("jsonConfigHelp")}
											</Description>
											{fieldState.error && (
												<FieldError>
													{fieldState.error.message}
												</FieldError>
											)}
											{!fieldState.error &&
												uiState.parseError && (
													<FieldError>
														{uiState.parseError}
													</FieldError>
												)}
										</TextField>
									)}
								/>
							</Fieldset.Group>
						</Fieldset>

						<div className="mt-6 flex justify-end gap-2">
							<Button
								type="button"
								variant="secondary"
								onPress={onDone}
							>
								{t("cancel")}
							</Button>
							<Button type="submit" isDisabled={isSubmitting}>
								{t("parseAndImport")}
							</Button>
						</div>
					</Form>
				</Card.Content>
			</Card>

			{/* Confirmation Dialog */}
			<Modal.Backdrop
				isOpen={uiState.showConfirmDialog}
				onOpenChange={(value) =>
					dispatch({
						type: "set_confirm_open",
						value,
					})
				}
			>
				<Modal.Container>
					<Modal.Dialog className="max-w-md">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>{t("confirmImport")}</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="p-4">
							{uiState.parsedConfig && (
								<div className="space-y-4">
									<div>
										<p className="mb-1 text-xs tracking-wide text-muted uppercase">
											{t("serverName")}
										</p>
										<p className="text-foreground">
											{uiState.parsedConfig.name}
										</p>
									</div>

									<div>
										<p className="mb-1 text-xs tracking-wide text-muted uppercase">
											{t("transportType")}
										</p>
										<p className="text-sm text-foreground">
											{uiState.parsedConfig.transportType}
										</p>
									</div>

									<div>
										<p className="mb-1 text-xs tracking-wide text-muted uppercase">
											{uiState.parsedConfig
												.transportType === "stdio"
												? t("command")
												: "URL"}
										</p>
										<p className="text-sm text-foreground">
											{uiState.parsedConfig
												.transportType === "stdio"
												? uiState.parsedConfig.config
														.command
												: uiState.parsedConfig.config
														.url}
										</p>
									</div>

									<div>
										<AgentSelector
											agents={usableAgents}
											selectedKeys={
												uiState.selectedAgents
											}
											onSelectionChange={(keys) => {
												dispatch({
													type: "set_selected_agents",
													value: keys,
												});
											}}
											label={t("selectAgentsForMcp")}
											emptyMessage={t("noTargetAgents")}
											variant="secondary"
											errorMessage={
												uiState.confirmError ||
												undefined
											}
										/>
									</div>
								</div>
							)}
						</Modal.Body>
						<Modal.Footer>
							<Button
								type="button"
								variant="secondary"
								onPress={() =>
									dispatch({
										type: "set_confirm_open",
										value: false,
									})
								}
							>
								{t("cancel")}
							</Button>
							<Button
								onPress={handleConfirmImport}
								isDisabled={createMutation.isPending}
							>
								{createMutation.isPending
									? t("importing")
									: t("confirm")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</div>
	);
}

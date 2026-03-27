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
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type { TransportDto } from "../lib/api-types";
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

export function ImportMcpPanel({ onDone, projectPath }: ImportMcpPanelProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const usableAgents = useMemo(
		() => availableAgents.filter((a) => a.isUsable),
		[availableAgents],
	);

	const [parseError, setParseError] = useState("");
	const [error, setError] = useState<string | null>(null);

	// Parsed configuration state
	const [parsedConfig, setParsedConfig] = useState<{
		name: string;
		config: McpServerConfig;
		transportType: "stdio" | "sse" | "streamable_http";
	} | null>(null);

	// Confirmation dialog state
	const [showConfirmDialog, setShowConfirmDialog] = useState(false);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(() => {
		return new Set(usableAgents[0] ? [usableAgents[0].id] : []);
	});
	const [confirmError, setConfirmError] = useState("");

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

	const handleParseJson = ({ jsonText }: ImportMcpFormValues) => {
		setParseError("");
		setError(null);
		setParsedConfig(null);

		try {
			const parsed: McpConfigJson = JSON.parse(jsonText);

			if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
				setParseError(t("parseError"));
				return;
			}

			const serverNames = Object.keys(parsed.mcpServers);
			if (serverNames.length === 0) {
				setParseError(t("parseError"));
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
				setParseError(t("parseError"));
				return;
			}

			setParsedConfig({ name: serverName, config, transportType });
			setConfirmError("");
			// Open confirmation dialog immediately after parsing
			setShowConfirmDialog(true);
		} catch {
			setParseError(t("invalidJson"));
		}
	};

	const handleConfirmImport = async () => {
		if (!parsedConfig) return;
		if (selectedAgents.size === 0) {
			setConfirmError(t("validationAgentsRequired"));
			return;
		}
		setConfirmError("");

		const { name, config, transportType } = parsedConfig;

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
				Array.from(selectedAgents).map((agent) =>
					createMutation.mutateAsync({ agent, body }),
				),
			);
			setShowConfirmDialog(false);
			reset();
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
												Boolean(parseError)
											}
										>
											<Label>{t("jsonConfig")}</Label>
											<TextArea
												value={field.value}
												onChange={(e) => {
													field.onChange(
														e.target.value,
													);
													if (parseError) {
														setParseError("");
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
												parseError && (
													<FieldError>
														{parseError}
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
				isOpen={showConfirmDialog}
				onOpenChange={setShowConfirmDialog}
			>
				<Modal.Container>
					<Modal.Dialog className="max-w-md">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>{t("confirmImport")}</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="p-4">
							{parsedConfig && (
								<div className="space-y-4">
									<div>
										<p className="mb-1 text-xs tracking-wide text-muted uppercase">
											{t("serverName")}
										</p>
										<p className="text-foreground">
											{parsedConfig.name}
										</p>
									</div>

									<div>
										<p className="mb-1 text-xs tracking-wide text-muted uppercase">
											{t("transportType")}
										</p>
										<p className="text-sm text-foreground">
											{parsedConfig.transportType}
										</p>
									</div>

									<div>
										<p className="mb-1 text-xs tracking-wide text-muted uppercase">
											{parsedConfig.transportType ===
											"stdio"
												? t("command")
												: "URL"}
										</p>
										<p className="text-sm text-foreground">
											{parsedConfig.transportType ===
											"stdio"
												? parsedConfig.config.command
												: parsedConfig.config.url}
										</p>
									</div>

									<div>
										<AgentSelector
											agents={usableAgents}
											selectedKeys={selectedAgents}
											onSelectionChange={(keys) => {
												setSelectedAgents(keys);
												if (keys.size > 0) {
													setConfirmError("");
												}
											}}
											label={t("selectAgentsForMcp")}
											emptyMessage={t("noTargetAgents")}
											variant="secondary"
											errorMessage={
												confirmError || undefined
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
								onPress={() => setShowConfirmDialog(false)}
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

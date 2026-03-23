import {
	Button,
	Description,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Modal,
	Select,
	TextArea,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createApi } from "../lib/api";
import type { TransportDto } from "../lib/api-types";
import { useAgentAvailability } from "../providers/agent-availability";
import { useServer } from "../providers/server";

interface CreateMcpDialogProps {
	isOpen: boolean;
	onClose: () => void;
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

export function CreateMcpDialog({ isOpen, onClose }: CreateMcpDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	// Get only usable agents (available and not disabled)
	const usableAgents = availableAgents.filter((a) => a.isUsable);

	const [name, setName] = useState("");
	const [transportType, setTransportType] = useState<
		"stdio" | "sse" | "streamable_http"
	>("stdio");
	const [timeout, setTimeoutValue] = useState("");
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
		new Set(["default"]),
	);

	// stdio fields
	const [command, setCommand] = useState("");
	const [args, setArgs] = useState("");
	const [env, setEnv] = useState("");

	// http fields
	const [url, setUrl] = useState("");
	const [headers, setHeaders] = useState("");

	// Import dialog state
	const [showImportDialog, setShowImportDialog] = useState(false);
	const [jsonText, setJsonText] = useState("");
	const [parseError, setParseError] = useState("");

	// Reset form when dialog opens
	useEffect(() => {
		if (isOpen) {
			setName("");
			setTransportType("stdio");
			setTimeoutValue("");
			setCommand("");
			setArgs("");
			setEnv("");
			setUrl("");
			setHeaders("");
			setSelectedAgents(new Set(["default"]));
		}
	}, [isOpen]);

	const createMutation = useMutation({
		mutationFn: ({
			agent,
			body,
		}: {
			agent: string;
			body: { name: string; transport: TransportDto; timeout?: number };
		}) => {
			return api.mcps.create(agent, "global", body);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mcps"] });
		},
	});

	const buildTransport = (): TransportDto | undefined => {
		const timeoutNum = timeout ? parseInt(timeout, 10) : undefined;

		if (transportType === "stdio") {
			const argsArray = args.trim() ? args.trim().split(/\s+/) : [];
			const envRecord: Record<string, string> | undefined = env.trim()
				? Object.fromEntries(
						env
							.trim()
							.split("\n")
							.map((line) => {
								const eqIndex = line.indexOf("=");
								if (eqIndex === -1) return [line, ""];
								return [
									line.slice(0, eqIndex),
									line.slice(eqIndex + 1),
								];
							}),
					)
				: undefined;

			return {
				type: "stdio",
				command: command.trim(),
				args: argsArray,
				env: envRecord,
				timeout: timeoutNum,
			};
		}

		const headersRecord: Record<string, string> | undefined = headers.trim()
			? Object.fromEntries(
					headers
						.trim()
						.split("\n")
						.map((line) => {
							const colonIndex = line.indexOf(":");
							if (colonIndex === -1) return [line.trim(), ""];
							return [
								line.slice(0, colonIndex).trim(),
								line.slice(colonIndex + 1).trim(),
							];
						}),
				)
			: undefined;

		return {
			type: transportType,
			url: url.trim(),
			headers: headersRecord,
			timeout: timeoutNum,
		};
	};

	const handleCreate = async () => {
		if (!name.trim()) return;

		const transport = buildTransport();
		if (!transport) return;

		const body = {
			name: name.trim(),
			transport,
			timeout: timeout ? parseInt(timeout, 10) : undefined,
		};

		// Create MCP for each selected agent
		const agentsToCreate = [...selectedAgents];
		await Promise.all(
			agentsToCreate.map((agent) =>
				createMutation.mutateAsync({ agent, body }),
			),
		);
		onClose();
	};

	const isValid = () => {
		if (!name.trim()) return false;
		if (transportType === "stdio" && !command.trim()) return false;
		if (transportType !== "stdio" && !url.trim()) return false;
		if (selectedAgents.size === 0) return false;
		if (usableAgents.length === 0) return false;
		return true;
	};

	const toggleAgent = (agentId: string) => {
		setSelectedAgents((prev) => {
			const next = new Set(prev);
			if (next.has(agentId)) {
				next.delete(agentId);
			} else {
				next.add(agentId);
			}
			return next;
		});
	};

	const handleImportJson = () => {
		setParseError("");

		try {
			const parsed: McpConfigJson = JSON.parse(jsonText);

			if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
				setParseError(t("parseError"));
				return;
			}

			// Get the first server configuration
			const serverNames = Object.keys(parsed.mcpServers);
			if (serverNames.length === 0) {
				setParseError(t("parseError"));
				return;
			}

			const serverName = serverNames[0];
			const config = parsed.mcpServers[serverName];

			// Set name
			setName(serverName);

			// Detect transport type and set fields
			if (config.command) {
				setTransportType("stdio");
				setCommand(config.command);
				if (config.args && Array.isArray(config.args)) {
					setArgs(config.args.join(" "));
				}
				if (config.env && typeof config.env === "object") {
					const envLines = Object.entries(config.env).map(
						([key, value]) => `${key}=${value}`,
					);
					setEnv(envLines.join("\n"));
				}
			} else if (config.url) {
				// Determine if SSE or streamable_http based on URL or default to sse
				setTransportType("sse");
				setUrl(config.url);
				if (config.headers && typeof config.headers === "object") {
					const headerLines = Object.entries(config.headers).map(
						([key, value]) => `${key}: ${value}`,
					);
					setHeaders(headerLines.join("\n"));
				}
			}

			if (config.timeout) {
				setTimeoutValue(config.timeout.toString());
			}

			// Close import dialog
			setShowImportDialog(false);
			setJsonText("");
		} catch (error) {
			setParseError(t("invalidJson"));
		}
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog className="max-w-lg">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("createMcpServer")}</Modal.Heading>
					</Modal.Header>
					<Modal.Body className="p-2">
						<Form>
							{/* Name */}
							<Fieldset>
								<Fieldset.Group>
									<TextField className="w-full">
										<Label>{t("name")}</Label>
										<Input
											value={name}
											onChange={(e) =>
												setName(e.target.value)
											}
											placeholder={t("serverName")}
										/>
									</TextField>
								</Fieldset.Group>
							</Fieldset>

							{/* Transport Type */}
							<Fieldset>
								<Fieldset.Group>
									<Select
										className="w-full"
										selectedKey={transportType}
										onSelectionChange={(key) =>
											setTransportType(
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
								</Fieldset.Group>
							</Fieldset>

							{/* Stdio fields */}
							{transportType === "stdio" && (
								<Fieldset>
									<Fieldset.Group>
										<TextField className="w-full">
											<Label>{t("command")}</Label>
											<Input
												value={command}
												onChange={(e) =>
													setCommand(e.target.value)
												}
												placeholder="npx"
											/>
										</TextField>
										<TextField className="w-full">
											<Label>{t("args")}</Label>
											<Input
												value={args}
												onChange={(e) =>
													setArgs(e.target.value)
												}
												placeholder="-y @modelcontextprotocol/server-filesystem"
											/>
											<Description>
												{t("argsHelp")}
											</Description>
										</TextField>
										<TextField className="w-full">
											<Label>{t("env")}</Label>
											<TextArea
												value={env}
												onChange={(e) =>
													setEnv(e.target.value)
												}
												placeholder="KEY=value&#10;ANOTHER_KEY=value"
												className="min-h-[80px] font-mono"
											/>
											<Description>
												{t("envHelp")}
											</Description>
										</TextField>
									</Fieldset.Group>
								</Fieldset>
							)}

							{/* HTTP fields */}
							{(transportType === "sse" ||
								transportType === "streamable_http") && (
								<Fieldset>
									<Fieldset.Group>
										<TextField className="w-full">
											<Label>URL</Label>
											<Input
												value={url}
												onChange={(e) =>
													setUrl(e.target.value)
												}
												placeholder="http://localhost:3000/sse"
											/>
										</TextField>
										<TextField className="w-full">
											<Label>{t("headers")}</Label>
											<TextArea
												value={headers}
												onChange={(e) =>
													setHeaders(e.target.value)
												}
												placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
												className="min-h-[80px] font-mono"
											/>
											<Description>
												{t("headersHelp")}
											</Description>
										</TextField>
									</Fieldset.Group>
								</Fieldset>
							)}

							{/* Timeout */}
							<Fieldset>
								<Fieldset.Group>
									<TextField className="w-full">
										<Label>{t("timeout")}</Label>
										<Input
											type="number"
											value={timeout}
											onChange={(e) =>
												setTimeoutValue(e.target.value)
											}
											placeholder="60"
										/>
										<Description>
											{t("timeoutHelp")}
										</Description>
									</TextField>
								</Fieldset.Group>
							</Fieldset>

							{/* Agent Selection */}
							<Fieldset>
								<Fieldset.Group>
									<div className="flex flex-col gap-2">
										<Label>{t("agents")}</Label>
										{usableAgents.length === 0 ? (
											<div className="text-sm text-muted">
												<p className="font-medium mb-1">
													{t("noAgentsAvailable")}
												</p>
												<p className="text-xs">
													{t("noAgentsAvailableHelp")}
												</p>
											</div>
										) : (
											<div className="flex flex-wrap gap-2">
												{usableAgents.map((agent) => {
													const isSelected =
														selectedAgents.has(
															agent.id,
														);
													return (
														<button
															key={agent.id}
															type="button"
															onClick={() =>
																toggleAgent(
																	agent.id,
																)
															}
															className={`px-2.5 py-1 text-sm rounded-full border transition-colors ${
																isSelected
																	? "bg-accent text-accent-foreground border-accent"
																	: "bg-transparent text-muted border-default-200 hover:border-default-300"
															}`}
														>
															{agent.display_name}
														</button>
													);
												})}
											</div>
										)}
									</div>
								</Fieldset.Group>
							</Fieldset>
						</Form>
					</Modal.Body>
					<Modal.Footer>
						<Button
							variant="secondary"
							onPress={() => setShowImportDialog(true)}
						>
							{t("importFromJson")}
						</Button>
						<Button
							slot="close"
							variant="secondary"
							onPress={onClose}
						>
							{t("cancel")}
						</Button>
						<Button
							onPress={handleCreate}
							isDisabled={!isValid() || createMutation.isPending}
						>
							{createMutation.isPending
								? t("creating")
								: t("create")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>

			{/* Import JSON Dialog */}
			<Modal.Backdrop
				isOpen={showImportDialog}
				onOpenChange={setShowImportDialog}
			>
				<Modal.Container>
					<Modal.Dialog className="max-w-lg">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>{t("importFromJson")}</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="p-2">
							<Fieldset>
								<Fieldset.Group>
									<TextField className="w-full">
										<Label>{t("jsonConfig")}</Label>
										<TextArea
											value={jsonText}
											onChange={(e) =>
												setJsonText(e.target.value)
											}
											placeholder={t(
												"jsonConfigPlaceholder",
											)}
											className="min-h-[300px] font-mono text-sm"
										/>
										<Description>
											{t("jsonConfigHelp")}
										</Description>
									</TextField>
									{parseError && (
										<div className="text-sm text-danger">
											{parseError}
										</div>
									)}
								</Fieldset.Group>
							</Fieldset>
						</Modal.Body>
						<Modal.Footer>
							<Button
								slot="close"
								variant="secondary"
								onPress={() => {
									setShowImportDialog(false);
									setJsonText("");
									setParseError("");
								}}
							>
								{t("cancel")}
							</Button>
							<Button
								onPress={handleImportJson}
								isDisabled={!jsonText.trim()}
							>
								{t("import")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal.Backdrop>
	);
}

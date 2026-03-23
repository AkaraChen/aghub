import {
	Button,
	Description,
	Disclosure,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Modal,
	Select,
	type Selection,
	Tag,
	TagGroup,
	TextArea,
	TextField,
	Tooltip,
} from "@heroui/react";
import { CodeBracketIcon } from "@heroicons/react/24/solid";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createApi } from "../lib/api";
import type { TransportDto } from "../lib/api-types";
import { useAgentAvailability } from "../providers/agent-availability";
import { useServer } from "../providers/server";
import { EnvEditor, type EnvVar } from "./env-editor";

interface CreateMcpPanelProps {
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

export function CreateMcpPanel({ onDone, projectPath }: CreateMcpPanelProps) {
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
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(() => {
		// Default to first usable agent instead of "default"
		return new Set(usableAgents[0] ? [usableAgents[0].id] : []);
	});

	// stdio fields
	const [command, setCommand] = useState("");
	const [args, setArgs] = useState("");
	const [envVars, setEnvVars] = useState<EnvVar[]>([]);

	// http fields
	const [url, setUrl] = useState("");
	const [headers, setHeaders] = useState("");

	// Import dialog state
	const [showImportDialog, setShowImportDialog] = useState(false);
	const [jsonText, setJsonText] = useState("");
	const [parseError, setParseError] = useState("");

	const createMutation = useMutation({
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
		const timeoutNum = timeout ? parseInt(timeout, 10) : undefined;

		if (transportType === "stdio") {
			const argsArray = args.trim() ? args.trim().split(/\s+/) : [];
			const envRecord: Record<string, string> | undefined =
				envVars.length > 0
					? Object.fromEntries(
							envVars.map((pair) => [pair.key, pair.value]),
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
		onDone();
	};

	const isValid = () => {
		if (!name.trim()) return false;
		if (transportType === "stdio" && !command.trim()) return false;
		if (transportType !== "stdio" && !url.trim()) return false;
		if (selectedAgents.size === 0) return false;
		if (usableAgents.length === 0) return false;
		return true;
	};

	const handleSelectionChange = (keys: Selection) => {
		setSelectedAgents(keys as Set<string>);
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
					const envVarArray: EnvVar[] = Object.entries(config.env).map(
						([key, value]) => ({ key, value }),
					);
					setEnvVars(envVarArray);
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
		<div className="h-full overflow-y-auto">
			<div className="p-6 max-w-3xl">
				<div className="flex items-center justify-between gap-3 mb-6">
					<h2 className="text-xl font-semibold text-foreground">
						{t("createMcpServer")}
					</h2>
					<Tooltip delay={0}>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="text-muted hover:text-foreground shrink-0"
							aria-label={t("importFromJson")}
							onPress={() => setShowImportDialog(true)}
						>
							<CodeBracketIcon className="size-4" />
						</Button>
						<Tooltip.Content>
							{t("importFromJsonTooltip")}
						</Tooltip.Content>
					</Tooltip>
				</div>

				<Form>
					{/* Name */}
					<Fieldset>
						<Fieldset.Group>
							<TextField className="w-full">
								<Label>{t("name")}</Label>
								<Input
									value={name}
									onChange={(e) => setName(e.target.value)}
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
										key as "stdio" | "sse" | "streamable_http",
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

					{/* Stdio fields */}
					{transportType === "stdio" && (
						<Fieldset>
							<Fieldset.Group>
								<TextField className="w-full">
									<Label>{t("command")}</Label>
									<Input
										value={command}
										onChange={(e) => setCommand(e.target.value)}
										placeholder="npx"

									/>
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
									<EnvEditor value={envVars} onChange={setEnvVars} />
									<Description>{t("envHelp")}</Description>
								</div>
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
										onChange={(e) => setUrl(e.target.value)}
										placeholder="http://localhost:3000/sse"


									/>
								</TextField>
								<TextField className="w-full">
									<Label>{t("headers")}</Label>
									<TextArea
										value={headers}
										onChange={(e) => setHeaders(e.target.value)}
										placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
										className="min-h-[80px] font-mono"


									/>
									<Description>{t("headersHelp")}</Description>
								</TextField>
							</Fieldset.Group>
						</Fieldset>
                  )}

					{/* Agent Selection */}
					<Fieldset>
						<Fieldset.Group>
							{usableAgents.length === 0 ? (
								<div className="flex flex-col gap-2">
									<Label>{t("agents")}</Label>
									<div className="text-sm text-muted">
										<p className="font-medium mb-1">
											{t("noAgentsAvailable")}
										</p>
										<p className="text-xs">{t("noAgentsAvailableHelp")}</p>
									</div>
								</div>
							) : (
								<TagGroup
									selectionMode="multiple"
									selectedKeys={selectedAgents}
									onSelectionChange={handleSelectionChange}
								>
									<Label>{t("agents")}</Label>
									<TagGroup.List className="flex-wrap">
										{usableAgents.map((agent) => (
											<Tag key={agent.id} id={agent.id}>
												{agent.display_name}
											</Tag>
										))}
									</TagGroup.List>
								</TagGroup>
							)}
						</Fieldset.Group>
					</Fieldset>

					<Disclosure className="pt-4">
						<Disclosure.Trigger className="flex items-center justify-between w-full">
							{t("advanced")}
							<Disclosure.Indicator />
						</Disclosure.Trigger>
						<Disclosure.Content>
							<Fieldset>
								<Fieldset.Group>
									<TextField className="w-full">
										<Label>{t("timeout")}</Label>
										<Input
											type="number"
											value={timeout}
											onChange={(e) => setTimeoutValue(e.target.value)}
											placeholder="60"
										/>
										<Description>{t("timeoutHelp")}</Description>
									</TextField>
								</Fieldset.Group>
							</Fieldset>
						</Disclosure.Content>
					</Disclosure>

					{/* Actions */}
					<div className="flex justify-end gap-2 pt-2">
						<Button variant="secondary" onPress={onDone}>
							{t("cancel")}
						</Button>
						<Button
							onPress={handleCreate}
							isDisabled={!isValid() || createMutation.isPending}
						>
							{createMutation.isPending ? t("creating") : t("create")}
						</Button>
					</div>
				</Form>
			</div>

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
											onChange={(e) => setJsonText(e.target.value)}
											placeholder={t("jsonConfigPlaceholder")}
											className="min-h-[300px] font-mono text-sm"
										/>
										<Description>{t("jsonConfigHelp")}</Description>
									</TextField>
									{parseError && (
										<div className="text-sm text-danger">{parseError}</div>
									)}
								</Fieldset.Group>
							</Fieldset>
						</Modal.Body>
						<Modal.Footer>
							<Button
								variant="secondary"
								onPress={() => {
									setShowImportDialog(false);
									setJsonText("");
									setParseError("");
								}}
							>
								{t("cancel")}
							</Button>
							<Button onPress={handleImportJson} isDisabled={!jsonText.trim()}>
								{t("import")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</div>
	);
}

import {
	Button,
	Description,
	Fieldset,
	Label,
	ListBox,
	Modal,
	Tag,
	TagGroup,
	TextArea,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type { TransportDto } from "../lib/api-types";
import { objectToKeyPairs } from "../lib/key-pair-utils";
import { buildTransportFromForm } from "../lib/mcp-utils";

interface ImportMcpDialogProps {
	isOpen: boolean;
	onClose: () => void;
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

export function ImportMcpDialog({
	isOpen,
	onClose,
	projectPath,
}: ImportMcpDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const usableAgents = useMemo(
		() => availableAgents.filter((a) => a.isUsable),
		[availableAgents],
	);

	const [jsonText, setJsonText] = useState("");
	const [parseError, setParseError] = useState("");
	const [parsedConfig, setParsedConfig] = useState<{
		name: string;
		config: McpServerConfig;
	} | null>(null);
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(() => {
		return new Set(usableAgents[0] ? [usableAgents[0].id] : []);
	});

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

	const handleParseJson = () => {
		setParseError("");

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

			setParsedConfig({ name: serverName, config });
		} catch {
			setParseError(t("invalidJson"));
		}
	};

	const handleImport = async () => {
		if (!parsedConfig || selectedAgents.size === 0) return;

		const { name, config } = parsedConfig;

		// Build transport from config
		let transport: TransportDto;
		if (config.command) {
			transport = {
				type: "stdio",
				command: config.command,
				args: config.args,
				env: config.env,
			};
		} else if (config.url) {
			transport = {
				type: "sse",
				url: config.url,
				headers: config.headers,
			};
		} else {
			setParseError(t("parseError"));
			return;
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
			handleClose();
		} catch {
			// Error is handled by mutation
		}
	};

	const handleClose = () => {
		setJsonText("");
		setParseError("");
		setParsedConfig(null);
		setSelectedAgents(new Set(usableAgents[0] ? [usableAgents[0].id] : []));
		onClose();
	};

	const isValid = useMemo(() => {
		return parsedConfig !== null && selectedAgents.size > 0;
	}, [parsedConfig, selectedAgents.size]);

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
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
										placeholder={t("jsonConfigPlaceholder")}
										className="min-h-75 font-mono text-sm"
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
								<Button
									onPress={handleParseJson}
									isDisabled={!jsonText.trim()}
									variant="secondary"
								>
									{t("parse")}
								</Button>
							</Fieldset.Group>
						</Fieldset>

						{parsedConfig && (
							<Fieldset>
								<Fieldset.Group>
									<div className="rounded-lg border border-accent-soft-hover bg-accent/5 p-3">
										<p className="mb-1 text-xs tracking-wide text-muted uppercase">
											{t("parsedServer")}
										</p>
										<p className="font-medium">
											{parsedConfig.name}
										</p>
										<p className="text-sm text-muted">
											{parsedConfig.config.command
												? `stdio: ${parsedConfig.config.command}`
												: `remote: ${parsedConfig.config.url}`}
										</p>
									</div>

									<div>
										<p className="mb-3 text-sm text-muted">
											{t("selectAgentsForMcp")}
										</p>

										{usableAgents.length === 0 ? (
											<div className="py-6 text-center">
												<p className="text-sm text-muted">
													{t("noTargetAgents")}
												</p>
											</div>
										) : (
											<TagGroup
												selectionMode="multiple"
												selectedKeys={selectedAgents}
												onSelectionChange={(keys) =>
													setSelectedAgents(
														keys as Set<string>,
													)
												}
												variant="surface"
											>
												<TagGroup.List className="flex-wrap">
													{usableAgents.map(
														(agent) => (
															<Tag
																key={agent.id}
																id={agent.id}
															>
																{
																	agent.display_name
																}
															</Tag>
														),
													)}
												</TagGroup.List>
											</TagGroup>
										)}
									</div>
								</Fieldset.Group>
							</Fieldset>
						)}
					</Modal.Body>
					<Modal.Footer>
						<Button variant="secondary" onPress={handleClose}>
							{t("cancel")}
						</Button>
						<Button
							onPress={handleImport}
							isDisabled={!isValid || createMutation.isPending}
						>
							{createMutation.isPending
								? t("importing")
								: t("import")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

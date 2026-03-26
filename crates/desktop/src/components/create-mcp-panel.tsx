import {
	Button,
	Card,
	Description,
	Disclosure,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Select,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type { TransportDto } from "../lib/api-types";
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
		if (!name.trim()) return;

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
		if (!name.trim()) return false;
		if (transportType === "stdio" && !command.trim()) return false;
		if (transportType !== "stdio" && !url.trim()) return false;
		if (selectedAgents.size === 0) return false;
		if (usableAgents.length === 0) return false;
		return true;
	}, [
		name,
		transportType,
		command,
		url,
		selectedAgents.size,
		usableAgents.length,
	]);

	return (
		<div className="h-full max-w-3xl overflow-y-auto p-6">
			{error && (
				<div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft p-3">
					<p className="text-sm text-danger">
						{t("createError", { error })}
					</p>
				</div>
			)}

			<Card>
				<Card.Header>
					<h2 className="text-xl font-semibold text-foreground">
						{t("createMcpServer")}
					</h2>
				</Card.Header>

				<Card.Content>
					<Form>
						<Fieldset variant="secondary">
							<Fieldset.Group>
								<TextField
									className="w-full"
									variant="secondary"
								>
									<Label>{t("name")}</Label>
									<Input
										value={name}
										onChange={(e) =>
											setName(e.target.value)
										}
										placeholder={t("serverName")}
										variant="secondary"
									/>
								</TextField>
							</Fieldset.Group>
						</Fieldset>

						<Fieldset variant="secondary">
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
									variant="secondary"
								>
									<Label>{t("transportType")}</Label>
									<Select.Trigger variant="secondary">
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
							<Fieldset variant="secondary">
								<Fieldset.Group>
									<TextField
										className="w-full"
										variant="secondary"
									>
										<Label>{t("command")}</Label>
										<Input
											value={command}
											onChange={(e) =>
												setCommand(e.target.value)
											}
											placeholder="npx"
											variant="secondary"
										/>
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
											onChange={setEnvVars}
											variant="secondary"
										/>
									</div>
								</Fieldset.Group>
							</Fieldset>
						)}

						{(transportType === "sse" ||
							transportType === "streamable_http") && (
							<Fieldset variant="secondary">
								<Fieldset.Group>
									<TextField
										className="w-full"
										variant="secondary"
									>
										<Label>URL</Label>
										<Input
											value={url}
											onChange={(e) =>
												setUrl(e.target.value)
											}
											placeholder="http://localhost:3000/sse"
											variant="secondary"
										/>
									</TextField>
									<div className="flex flex-col gap-2">
										<Label>{t("headers")}</Label>
										<HttpHeaderEditor
											value={httpHeaders}
											onChange={setHttpHeaders}
											variant="secondary"
										/>
									</div>
								</Fieldset.Group>
							</Fieldset>
						)}

						<Fieldset variant="secondary">
							<Fieldset.Group>
								<AgentSelector
									agents={usableAgents}
									selectedKeys={selectedAgents}
									onSelectionChange={setSelectedAgents}
									label={t("agents")}
									emptyMessage={t("noAgentsAvailable")}
									emptyHelpText={t("noAgentsAvailableHelp")}
									variant="secondary"
								/>
							</Fieldset.Group>
						</Fieldset>

						<Disclosure className="pt-4">
							<Disclosure.Trigger className="flex w-full items-center justify-between">
								{t("advanced")}
								<Disclosure.Indicator />
							</Disclosure.Trigger>
							<Disclosure.Content>
								<Fieldset variant="secondary">
									<Fieldset.Group>
										<TextField
											className="w-full"
											variant="secondary"
										>
											<Label>{t("timeout")}</Label>
											<Input
												type="number"
												value={timeoutValue}
												onChange={(e) =>
													setTimeoutValue(
														e.target.value,
													)
												}
												placeholder="60"
												variant="secondary"
											/>
											<Description>
												{t("timeoutHelp")}
											</Description>
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

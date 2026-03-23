import {
	Button,
	Description,
	Disclosure,
	Fieldset,
	Form,
	Input,
	Label,
	ListBox,
	Select,
	TextArea,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createApi, type UpdateMcpRequest } from "../lib/api";
import type { McpResponse, TransportDto } from "../lib/api-types";
import { useServer } from "../providers/server";
import { EnvEditor, type EnvVar } from "./env-editor";

interface EditMcpPanelProps {
	group: {
		mergeKey: string;
		transport: McpResponse["transport"];
		items: McpResponse[];
	};
	onDone: () => void;
	projectPath?: string;
}

export function EditMcpPanel({ group, onDone, projectPath }: EditMcpPanelProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();

	const primaryServer = group.items[0];

	const [name, setName] = useState(primaryServer.name);
	const [transportType, setTransportType] = useState<
		"stdio" | "sse" | "streamable_http"
	>(primaryServer.transport.type);
	const [timeout, setTimeoutValue] = useState(
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
			return Object.entries(primaryServer.transport.env).map(
				([key, value]) => ({ key, value }),
			);
		}
		return [];
	});

	const [url, setUrl] = useState(
		primaryServer.transport.type !== "stdio"
			? primaryServer.transport.url
			: "",
	);
	const [headers, setHeaders] = useState(() => {
		if (
			primaryServer.transport.type !== "stdio" &&
			primaryServer.transport.headers
		) {
			return Object.entries(primaryServer.transport.headers)
				.map(([k, v]) => `${k}: ${v}`)
				.join("\n");
		}
		return "";
	});

	useEffect(() => {
		const primary = group.items[0];
		setName(primary.name);
		setTransportType(primary.transport.type);
		setTimeoutValue(primary.timeout?.toString() ?? "");

		if (primary.transport.type === "stdio") {
			setCommand(primary.transport.command);
			setArgs(primary.transport.args?.join(" ") ?? "");
			setEnvVars(
				primary.transport.env
					? Object.entries(primary.transport.env).map(([key, value]) => ({
							key,
							value,
						}))
					: [],
			);
			setUrl("");
			setHeaders("");
		} else {
			setUrl(primary.transport.url);
			setHeaders(
				primary.transport.headers
					? Object.entries(primary.transport.headers)
							.map(([k, v]) => `${k}: ${v}`)
							.join("\n")
					: "",
			);
			setCommand("");
			setArgs("");
			setEnvVars([]);
		}
	}, [group]);

	const updateMutation = useMutation({
		mutationFn: (body: UpdateMcpRequest) => {
			return Promise.all(
				group.items.map((item) => {
					const scope =
						item.source === "Project" ? "project" : "global";
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
			console.error("Failed to update MCP servers:", error);
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

	const handleSave = () => {
		if (!name.trim()) return;

		const body: UpdateMcpRequest = {
			name: name.trim() !== primaryServer.name ? name.trim() : undefined,
			timeout: timeout ? parseInt(timeout, 10) : undefined,
		};

		const transport = buildTransport();
		if (transport) {
			body.transport = transport;
		}

		updateMutation.mutate(body);
	};

	const isValid = () => {
		if (!name.trim()) return false;
		if (transportType === "stdio" && !command.trim()) return false;
		if (transportType !== "stdio" && !url.trim()) return false;
		return true;
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-6 max-w-3xl">
				<div className="flex items-center justify-between gap-3 mb-6">
					<h2 className="text-xl font-semibold text-foreground">
						{t("editMcpServer")}
					</h2>
				</div>

				{group.items.length > 1 && (
					<div className="bg-warning/10 border border-warning/20 rounded-lg p-3 mb-4">
						<p className="text-sm text-warning">
							{t("changeWillApplyToAgents", {
								count: group.items.length,
								agents: group.items
									.map((i) =>
										i.agent
											? i.agent.charAt(0).toUpperCase() +
												i.agent.slice(1).toLowerCase()
											: "Default",
									)
									.join(", "),
							})}
						</p>
					</div>
				)}

				<Form>
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
											onChange={(e) =>
												setTimeoutValue(e.target.value)
											}
											placeholder="60"
										/>
										<Description>{t("timeoutHelp")}</Description>
									</TextField>
								</Fieldset.Group>
							</Fieldset>
						</Disclosure.Content>
					</Disclosure>

						<div className="flex justify-end gap-2 pt-2">
						<Button variant="secondary" onPress={onDone}>
							{t("cancel")}
						</Button>
						<Button
							onPress={handleSave}
							isDisabled={!isValid() || updateMutation.isPending}
						>
							{updateMutation.isPending ? t("saving") : t("save")}
						</Button>
					</div>
				</Form>
			</div>
		</div>
	);
}

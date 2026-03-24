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
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateMcpRequest } from "../lib/api";
import { createApi } from "../lib/api";
import type { McpResponse, TransportDto } from "../lib/api-types";
import { ConfigSource } from "../lib/api-types";
import { buildTransportFromForm, capitalize } from "../lib/mcp-utils";
import { useServer } from "../hooks/use-server";
import type { EnvVar } from "./env-editor";
import { EnvEditor } from "./env-editor";
import type { HttpHeader } from "./http-header-editor";
import { HttpHeaderEditor } from "./http-header-editor";
import {
	createEmptyKeyPair,
	objectToKeyPairs,
} from "../lib/key-pair-utils";

interface EditMcpDialogProps {
	group: {
		mergeKey: string;
		transport: McpResponse["transport"];
		items: McpResponse[];
	};
	isOpen: boolean;
	onClose: () => void;
}

export function EditMcpDialog({ group, isOpen, onClose }: EditMcpDialogProps) {
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
		return [createEmptyKeyPair()];
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
		return [createEmptyKeyPair()];
	});

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
					);
				}),
			);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mcps"] });
			onClose();
		},
		onError: (error) => {
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
		if (!name.trim()) return;

		const body: UpdateMcpRequest = {
			name: name.trim() !== primaryServer.name ? name.trim() : undefined,
				timeout: timeoutValue ? Number.parseInt(timeoutValue, 10) : undefined,
		};

		const transport = buildTransport();
		if (transport) {
			body.transport = transport;
		}

		updateMutation.mutate(body);
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog className="max-w-lg">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("editMcpServer")}</Modal.Heading>
					</Modal.Header>
					<Modal.Body className="p-2">
						{group.items.length > 1 && (
							<div className="
         mb-4 rounded-lg border border-warning-soft-hover bg-warning/10 p-3
       ">
								<p className="text-sm text-warning">
									{t("changeWillApplyToAgents", {
										count: group.items.length,
										agents: agentNamesList,
									})}
								</p>
							</div>
						)}
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
										<div className="flex flex-col gap-2">
											<Label>{t("env")}</Label>
											<EnvEditor
												value={envVars}
												onChange={setEnvVars}
											/>
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
												onChange={(e) =>
													setUrl(e.target.value)
												}
												placeholder="http://localhost:3000/sse"
											/>
										</TextField>
										<div className="flex flex-col gap-2">
											<Label>{t("headers")}</Label>
											<HttpHeaderEditor
												value={httpHeaders}
												onChange={setHttpHeaders}
											/>
										</div>
									</Fieldset.Group>
								</Fieldset>
							)}

							<Fieldset>
								<Fieldset.Group>
									<TextField className="w-full">
										<Label>{t("timeout")}</Label>
								<Input
									type="number"
									value={timeoutValue}
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
						</Form>
					</Modal.Body>
					<Modal.Footer>
						<Button
							slot="close"
							variant="secondary"
							onPress={onClose}
						>
							{t("cancel")}
						</Button>
						<Button
							onPress={handleSave}
							isDisabled={
								!name.trim() || updateMutation.isPending
							}
						>
							{updateMutation.isPending ? t("saving") : t("save")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

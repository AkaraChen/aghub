"use client";

import {
	CheckCircleIcon,
	ClipboardDocumentIcon,
	DocumentDuplicateIcon,
} from "@heroicons/react/24/solid";
import { Button, toast } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CCPluginDetailResponse } from "../../generated/dto";
import { CodeBlock, MetaRow } from "./meta-blocks";

interface McpServersSectionProps {
	config?: CCPluginDetailResponse["mcp_config"];
}

type PluginMcpServer = NonNullable<
	CCPluginDetailResponse["mcp_config"]
>["servers"][number];
type CopyMode = "config" | "value";

function formatTransportLabel(transportType: string) {
	return transportType === "streamable_http"
		? "Streamable HTTP"
		: transportType.toUpperCase();
}

function buildCommandLine(command: string, args?: string[]) {
	return args && args.length > 0 ? `${command} ${args.join(" ")}` : command;
}

function KeyValueBlock({
	label,
	values,
}: {
	label: string;
	values: Record<string, string>;
}) {
	return (
		<div className="space-y-3">
			<h4 className="text-xs font-medium tracking-wider text-muted uppercase">
				{label}
			</h4>
			<div className="space-y-2">
				{Object.entries(values).map(([key, value]) => (
					<div
						key={key}
						className="grid gap-1 rounded-lg border border-separator bg-surface-secondary px-3 py-2"
					>
						<span className="font-mono text-[11px] text-muted">
							{key}
						</span>
						<code className="font-mono text-xs leading-5 text-foreground break-words">
							{value}
						</code>
					</div>
				))}
			</div>
		</div>
	);
}

function serializeServerConfig(server: PluginMcpServer) {
	const config = server.command
		? {
				command: server.command,
				...(server.args && server.args.length > 0
					? { args: server.args }
					: {}),
				...(server.env ? { env: server.env } : {}),
			}
		: {
				url: server.url,
				...(server.transport_type === "streamable_http"
					? { type: "streamable_http" as const }
					: {}),
				...(server.headers ? { headers: server.headers } : {}),
			};

	return JSON.stringify(
		{
			mcpServers: {
				[server.name]: config,
			},
		},
		null,
		2,
	);
}

export function McpServersSection({ config }: McpServersSectionProps) {
	const { t } = useTranslation();
	const [copiedState, setCopiedState] = useState<{
		serverName: string;
		mode: CopyMode;
	} | null>(null);

	if (!config || config.servers.length === 0) {
		return null;
	}

	const handleCopy = async (server: PluginMcpServer, mode: CopyMode) => {
		const value =
			mode === "config"
				? serializeServerConfig(server)
				: server.command
					? buildCommandLine(server.command, server.args)
					: (server.url ?? "");

		if (!value) {
			return;
		}

		try {
			await navigator.clipboard.writeText(value);
			setCopiedState({
				serverName: server.name,
				mode,
			});
			setTimeout(() => {
				setCopiedState((current) =>
					current?.serverName === server.name && current.mode === mode
						? null
						: current,
				);
			}, 2000);
			toast.success(t("copyConfigSuccess"));
		} catch (error) {
			console.error("Failed to copy plugin MCP content:", error);
			toast.danger(t("copyConfigError"));
		}
	};

	return (
		<div className="space-y-3">
			<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
				{t("mcpServers")}
			</h3>
			<div className="space-y-3">
				{config.servers.map((server) => (
					<div
						key={server.name}
						className="space-y-4 rounded-xl border border-separator/60 bg-surface-secondary/40 px-3 py-3"
					>
						<div className="flex items-baseline gap-2">
							<span className="text-sm font-medium text-foreground">
								{server.name}
							</span>
							<span className="font-mono text-xs text-muted">
								({formatTransportLabel(server.transport_type)})
							</span>
						</div>

						{server.note && (
							<p className="text-sm leading-6 text-muted">
								{server.note}
							</p>
						)}

						<div className="grid gap-4">
							{server.command ? (
								<CodeBlock
									label={t("command")}
									command={server.command}
									args={server.args}
								/>
							) : (
								server.url && (
									<MetaRow
										label={t("url")}
										value={server.url}
										mono
									/>
								)
							)}

							{server.env &&
								Object.keys(server.env).length > 0 && (
									<KeyValueBlock
										label={t("envCount", {
											count: Object.keys(server.env)
												.length,
										})}
										values={server.env}
									/>
								)}

							{server.headers &&
								Object.keys(server.headers).length > 0 && (
									<KeyValueBlock
										label={t("headersCount", {
											count: Object.keys(server.headers)
												.length,
										})}
										values={server.headers}
									/>
								)}
						</div>

						<div className="flex flex-wrap gap-2 border-t border-separator/70 pt-3">
							<Button
								variant="secondary"
								size="sm"
								onPress={() => handleCopy(server, "config")}
							>
								{copiedState?.serverName === server.name &&
								copiedState.mode === "config" ? (
									<CheckCircleIcon className="size-4 text-success" />
								) : (
									<DocumentDuplicateIcon className="size-4" />
								)}
								{copiedState?.serverName === server.name &&
								copiedState.mode === "config"
									? t("copied")
									: t("copyConfig")}
							</Button>

							<Button
								variant="secondary"
								size="sm"
								onPress={() => handleCopy(server, "value")}
								isDisabled={!server.command && !server.url}
							>
								{copiedState?.serverName === server.name &&
								copiedState.mode === "value" ? (
									<CheckCircleIcon className="size-4 text-success" />
								) : (
									<ClipboardDocumentIcon className="size-4" />
								)}
								{copiedState?.serverName === server.name &&
								copiedState.mode === "value"
									? t("copied")
									: t("copy")}
							</Button>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

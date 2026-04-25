"use client";

import {
	CheckCircleIcon,
	ClipboardDocumentIcon,
	DocumentDuplicateIcon,
} from "@heroicons/react/24/solid";
import { Button, toast } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CCPluginDetailResponse, TransportDto } from "../../generated/dto";
import { KeyValueList } from "../key-value-list";
import { CodeBlock, MetaRow } from "../meta-blocks";
import { serializeMcpImportJson } from "../../lib/mcp-utils";

interface McpServersSectionProps {
	config?: CCPluginDetailResponse["mcp_config"];
}

type PluginMcpServer = NonNullable<
	CCPluginDetailResponse["mcp_config"]
>["servers"][number];
type CopyMode = "config" | "value";

export function McpServersSection({ config }: McpServersSectionProps) {
	const { t } = useTranslation();
	const [copiedState, setCopiedState] = useState<{
		serverName: string;
		mode: CopyMode;
	} | null>(null);
	const [expandedBlocks, setExpandedBlocks] = useState<
		Record<string, boolean>
	>({});

	if (!config || config.servers.length === 0) {
		return null;
	}

	const handleCopy = async (server: PluginMcpServer, mode: CopyMode) => {
		const transport: TransportDto = server.command
			? {
					type: "stdio",
					command: server.command,
					args: server.args ?? [],
					env: server.env ?? null,
					timeout: null,
				}
			: {
					type:
						server.transport_type === "streamable_http"
							? "streamable_http"
							: "sse",
					url: server.url ?? "",
					headers: server.headers ?? null,
					timeout: null,
				};
		const value =
			mode === "config"
				? serializeMcpImportJson(server.name, transport)
				: server.command
					? [server.command, ...(server.args ?? [])].join(" ")
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
		} catch {
			toast.danger(t("copyConfigError"));
		}
	};

	return (
		<div className="space-y-3">
			<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
				{t("mcpServers")}
			</h3>
			<div className="space-y-3">
				{config.servers.map((server) => {
					const headerEntries = server.headers
						? Object.entries(server.headers)
						: [];
					const envEntries = server.env
						? Object.entries(server.env)
						: [];
					const headersKey = `${server.name}:headers`;
					const envKey = `${server.name}:env`;
					const showAllHeaders = expandedBlocks[headersKey] ?? false;
					const showAllEnv = expandedBlocks[envKey] ?? false;
					const transportLabel =
						server.transport_type === "streamable_http"
							? "Streamable HTTP"
							: server.transport_type;

					return (
						<div
							key={server.name}
							className="space-y-4 rounded-xl border border-separator/60 bg-surface-secondary/60 px-3 py-3"
						>
							<div className="flex items-baseline gap-2">
								<span className="text-sm font-medium text-foreground">
									{server.name}
								</span>
								<span className="font-mono text-xs text-muted">
									({transportLabel})
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

								{envEntries.length > 0 && (
									<div className="space-y-3">
										<h4 className="text-xs font-medium tracking-wider text-muted uppercase">
											{t("envCount", {
												count: envEntries.length,
											})}
										</h4>
										<KeyValueList
											items={envEntries}
											showAll={showAllEnv}
											onToggle={() =>
												setExpandedBlocks(
													(current) => ({
														...current,
														[envKey]: !(
															current[envKey] ??
															false
														),
													}),
												)
											}
											showMoreLabel={(count) =>
												t("showMore", { count })
											}
											showLessLabel={t("showLess")}
										/>
									</div>
								)}

								{headerEntries.length > 0 && (
									<div className="space-y-3">
										<h4 className="text-xs font-medium tracking-wider text-muted uppercase">
											{t("headersCount", {
												count: headerEntries.length,
											})}
										</h4>
										<KeyValueList
											items={headerEntries}
											showAll={showAllHeaders}
											onToggle={() =>
												setExpandedBlocks(
													(current) => ({
														...current,
														[headersKey]: !(
															current[
																headersKey
															] ?? false
														),
													}),
												)
											}
											showMoreLabel={(count) =>
												t("showMore", { count })
											}
											showLessLabel={t("showLess")}
										/>
									</div>
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
					);
				})}
			</div>
		</div>
	);
}

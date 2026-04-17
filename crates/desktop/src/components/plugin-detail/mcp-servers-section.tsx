"use client";

import { Chip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { CCPluginDetailResponse } from "../../generated/dto";
import { CodeBlock, MetaRow } from "./meta-blocks";

interface McpServersSectionProps {
	config?: CCPluginDetailResponse["mcp_config"];
}

export function McpServersSection({ config }: McpServersSectionProps) {
	const { t } = useTranslation();

	if (!config || config.servers.length === 0) {
		return null;
	}

	return (
		<div className="space-y-3">
			<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
				MCP Servers
			</h3>
			<div className="space-y-3">
				{config.servers.map((server) => (
					<div
						key={server.name}
						className="space-y-2 rounded-lg border border-separator bg-surface-secondary px-3 py-3"
					>
						<div className="flex items-center gap-2">
							<span className="font-medium text-sm">
								{server.name}
							</span>
							<Chip
								size="sm"
								variant="soft"
								className="h-[18px] px-1.5 text-[10px]"
							>
								{server.transport_type}
							</Chip>
						</div>
						{server.note && (
							<p className="text-[11px] text-muted">
								{server.note}
							</p>
						)}
						{server.command && (
							<CodeBlock
								label={t("command")}
								command={server.command}
								args={server.args}
							/>
						)}
						{server.env && server.env.length > 0 && (
							<CodeBlock
								label={
									t("environmentVariables") ||
									"Environment Variables"
								}
								command={server.env.join("\n")}
							/>
						)}
						{server.headers && server.headers.length > 0 && (
							<CodeBlock
								label={t("headers")}
								command={server.headers.join("\n")}
							/>
						)}
						{server.url && (
							<MetaRow label="URL" value={server.url} mono />
						)}
					</div>
				))}
			</div>
		</div>
	);
}

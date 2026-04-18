"use client";

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
						className="space-y-3 rounded-lg bg-surface-secondary px-3 py-2"
					>
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium">
								{server.name}
							</span>
							<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
								{server.transport_type}
							</span>
						</div>
						{server.note && (
							<p className="text-sm text-muted">{server.note}</p>
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

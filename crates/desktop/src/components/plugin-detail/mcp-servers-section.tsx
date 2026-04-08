"use client";

import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { Button, Chip } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CCPluginDetailResponse } from "../../generated/dto";
import { CodeBlock, MetaRow } from "./meta-blocks";

const MASKED_ENV_VALUE = "••••••••";

function maskEnvironmentValue(value: string) {
	return value.length > 0 ? MASKED_ENV_VALUE : "";
}

interface McpServersSectionProps {
	config?: CCPluginDetailResponse["mcp_config"];
}

export function McpServersSection({ config }: McpServersSectionProps) {
	const { t } = useTranslation();
	const [revealedValues, setRevealedValues] = useState<
		Record<string, boolean>
	>({});

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
						className="rounded-lg bg-surface-secondary px-3 py-3 space-y-2"
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
						{server.env && Object.keys(server.env).length > 0 && (
							<div className="grid gap-1.5 pt-1">
								<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
									{t("environmentVariables") ||
										"Environment Variables"}
								</span>
								<div className="space-y-2">
									{Object.entries(server.env).map(
										([key, value]) => {
											const entryId = `${server.name}:${key}`;
											const isRevealed =
												revealedValues[entryId] ??
												false;

											return (
												<div
													key={key}
													className="grid gap-1 rounded-lg border border-separator bg-surface-secondary px-3 py-2"
												>
													<div className="flex items-center justify-between gap-2">
														<span className="font-mono text-[11px] text-muted">
															{key}
														</span>
														<Button
															isIconOnly
															size="sm"
															variant="ghost"
															className="h-6 w-6 min-w-6 text-muted"
															aria-label={
																isRevealed
																	? t(
																			"hide",
																			{
																				defaultValue:
																					"Hide",
																			},
																		)
																	: t(
																			"show",
																			{
																				defaultValue:
																					"Show",
																			},
																		)
															}
															onPress={() => {
																setRevealedValues(
																	(
																		current,
																	) => ({
																		...current,
																		[entryId]:
																			!isRevealed,
																	}),
																);
															}}
														>
															{isRevealed ? (
																<EyeSlashIcon className="size-4" />
															) : (
																<EyeIcon className="size-4" />
															)}
														</Button>
													</div>
													<code className="font-mono text-xs leading-5 text-foreground break-words">
														{isRevealed
															? String(value)
															: maskEnvironmentValue(
																	String(
																		value,
																	),
																)}
													</code>
												</div>
											);
										},
									)}
								</div>
							</div>
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

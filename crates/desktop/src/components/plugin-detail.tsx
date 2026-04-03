"use client";

import {
	BoltIcon,
	CpuChipIcon,
	FolderOpenIcon,
	WrenchIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Chip, Switch, Tooltip } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { PluginResponse } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { skillListQueryOptions } from "../requests/skills";

interface PluginDetailProps {
	plugin: PluginResponse;
	selectedCount?: number;
	selectedPlugins?: PluginResponse[];
}

function pluginDetailQueryOptions(
	api: ReturnType<typeof useApi>,
	pluginId: string,
) {
	return {
		queryKey: ["plugin-detail", pluginId],
		queryFn: () => api.plugins.detail(pluginId),
		enabled: !!pluginId,
	};
}

export function PluginDetail({
	plugin,
	selectedCount = 0,
	selectedPlugins = [],
}: PluginDetailProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const { data: allSkills } = useQuery({
		...skillListQueryOptions({ api, scope: "global" }),
	});

	const { data: pluginDetail } = useQuery({
		...pluginDetailQueryOptions(api, plugin.id),
	});

	// Use latest data from API if available, otherwise fallback to props
	const currentPlugin = pluginDetail ?? plugin;

	const enableMutation = useMutation({
		mutationFn: (id: string) => api.plugins.enable(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["plugins"] });
			queryClient.invalidateQueries({ queryKey: ["skills"] });
			queryClient.invalidateQueries({ queryKey: ["plugin-detail", plugin.id] });
		},
	});

	const disableMutation = useMutation({
		mutationFn: (id: string) => api.plugins.disable(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["plugins"] });
			queryClient.invalidateQueries({ queryKey: ["skills"] });
			queryClient.invalidateQueries({ queryKey: ["plugin-detail", plugin.id] });
		},
	});

	const isToggling = enableMutation.isPending || disableMutation.isPending;

	const pluginSkills =
		allSkills?.filter((skill) => skill.plugin_id === currentPlugin.id) ?? [];

	const hooks = pluginDetail?.hooks;
	const mcpConfig = pluginDetail?.mcp_config;

	const handleOpenInstallPath = async () => {
		try {
			await openUrl(`file://${plugin.install_path}`);
		} catch {
			// Silent fail
		}
	};

	// Multi-select mode shows summary
	if (selectedCount > 1) {
		return (
			<div className="h-full overflow-y-auto">
				<div className="w-full space-y-4 p-4 sm:p-6">
					<Card>
						<Card.Header>
							<h2 className="text-xl font-semibold text-foreground">
								{t("itemsSelected", { count: selectedCount })}
							</h2>
						</Card.Header>
						<Card.Content className="flex flex-col gap-6">
							<div className="space-y-3">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("selectedItems")}
								</h3>
								<div className="space-y-2">
									{selectedPlugins.map((p) => (
										<div
											key={p.id}
											className="flex items-center justify-between rounded-lg border border-separator bg-surface-secondary px-3 py-2"
										>
											<div className="flex items-center gap-2">
												<div
													className={`size-2 rounded-full ${p.enabled ? "bg-success" : "bg-muted"}`}
												/>
												<span className="font-medium">
													{p.name}
												</span>
												<span className="text-xs text-muted">
													v{p.version}
												</span>
											</div>
										</div>
									))}
								</div>
							</div>
						</Card.Content>
					</Card>
				</div>
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full space-y-4 p-4 sm:p-6">
				<Card>
					{/* Header: Name + Version + Enable Switch */}
					<Card.Header className="flex flex-row items-start justify-between gap-3">
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<h2 className="text-xl font-semibold text-foreground truncate">
									{plugin.name}
								</h2>
								<span className="text-sm text-muted">
									v{plugin.version}
								</span>
							</div>
							<p className="text-xs text-muted mt-1">
								{plugin.id}
							</p>
						</div>
						<Switch
							isSelected={currentPlugin.enabled}
							isDisabled={isToggling}
							onChange={() => {
								if (currentPlugin.enabled) {
									disableMutation.mutate(currentPlugin.id);
								} else {
									enableMutation.mutate(currentPlugin.id);
								}
							}}
							aria-label={
								currentPlugin.enabled
									? t("disablePlugin")
									: t("enablePlugin")
							}
						>
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
						</Switch>
					</Card.Header>

					<Card.Content className="flex flex-col gap-6">
						{/* Description */}
						{currentPlugin.description && (
							<div className="space-y-3">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("description")}
								</h3>
								<p className="text-sm text-foreground">
									{currentPlugin.description}
								</p>
							</div>
						)}

						{/* Capabilities */}
						<div className="space-y-3">
							<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
								{t("capabilities")}
							</h3>
							<div className="flex flex-wrap gap-2">
								{currentPlugin.has_skills && (
									<Chip
										size="md"
										variant="soft"
										className="gap-1"
									>
										<WrenchIcon className="size-3.5" />
										{t("skills")}
										{pluginSkills.length > 0 && (
											<span className="ml-1">
												({pluginSkills.length})
											</span>
										)}
									</Chip>
								)}
								{currentPlugin.has_hooks && (
									<Chip
										size="md"
										variant="soft"
										className="gap-1"
									>
										<BoltIcon className="size-3.5" />
										Hooks
									</Chip>
								)}
								{plugin.has_mcp && (
									<Chip
										size="md"
										variant="soft"
										className="gap-1"
									>
										<CpuChipIcon className="size-3.5" />
										MCP
									</Chip>
								)}
								{!currentPlugin.has_skills &&
									!currentPlugin.has_hooks &&
									!currentPlugin.has_mcp && (
										<p className="text-sm text-muted">
											{t("noCapabilities")}
										</p>
									)}
							</div>
						</div>

						{/* Plugin Skills */}
						{pluginSkills.length > 0 && (
							<div className="space-y-3">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providedSkills")}
								</h3>
								<div className="space-y-2">
									{pluginSkills.map((skill) => (
										<div
											key={skill.name}
											className="rounded-lg border border-separator bg-surface-secondary px-3 py-2"
										>
											<div className="flex items-center justify-between">
												<div className="min-w-0">
													<p className="font-medium text-sm truncate">
														{skill.name}
													</p>
													{skill.description && (
														<p className="text-xs text-muted truncate">
															{skill.description}
														</p>
													)}
												</div>
												{skill.tools.length > 0 && (
													<div className="flex gap-1">
														{skill.tools
															.slice(0, 3)
															.map((tool) => (
																<Chip
																	key={tool}
																	size="sm"
																	variant="soft"
																>
																	{tool}
																</Chip>
															))}
														{skill.tools.length >
															3 && (
															<Chip
																size="sm"
																variant="soft"
															>
																+
																{skill.tools
																	.length - 3}
															</Chip>
														)}
													</div>
												)}
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Installation Info */}
						<div className="space-y-3">
							<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
								{t("installationInfo")}
							</h3>
							<div className="space-y-2">
								<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
									<div className="min-w-0 flex-1">
										<p className="text-[11px] font-medium tracking-wide text-muted uppercase">
											{t("source")}
										</p>
										<p className="text-sm text-foreground truncate">
											{currentPlugin.source}
										</p>
									</div>
								</div>
								<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
									<div className="min-w-0 flex-1">
										<p className="text-[11px] font-medium tracking-wide text-muted uppercase">
											{t("installPath")}
										</p>
										<code className="block text-xs font-mono text-foreground truncate">
											{currentPlugin.install_path}
										</code>
									</div>
									<Tooltip delay={0}>
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											onPress={handleOpenInstallPath}
											aria-label={t("openInstallFolder")}
										>
											<FolderOpenIcon className="size-4" />
										</Button>
										<Tooltip.Content>
											{t("openInstallFolder")}
										</Tooltip.Content>
									</Tooltip>
								</div>
							</div>
						</div>

						{/* Hooks Configuration */}
						{hooks && hooks.hooks.length > 0 && (
							<div className="space-y-3">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									Hooks
								</h3>
								<div className="space-y-2">
									{hooks.hooks.map((event) => (
										<div
											key={event.event}
											className="rounded-lg border border-separator bg-surface-secondary px-3 py-2"
										>
											<div className="flex items-center gap-2 mb-2">
												<BoltIcon className="size-4 text-warning" />
												<span className="font-medium text-sm">
													{event.event}
												</span>
											</div>
											<div className="space-y-1">
												{ }
												{event.matchers.map(
													(matcher, idx) => (
														<div
															key={`${event.event}-${matcher.matcher ?? "all"}-${idx}`}
															className="text-xs text-muted"
														>
															{matcher.matcher ? (
																<code className="bg-surface px-1 py-0.5 rounded">
																	Matcher:{" "}
																	{
																		matcher.matcher
																	}
																</code>
															) : (
																<span>
																	All events
																</span>
															)}
															<span className="ml-2">
																{
																	matcher
																		.hooks
																		.length
																}{" "}
																hook(s)
															</span>
														</div>
													),
												)}
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* MCP Servers */}
						{mcpConfig && mcpConfig.servers.length > 0 && (
							<div className="space-y-3">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									MCP Servers
								</h3>
								<div className="space-y-2">
									{mcpConfig.servers.map((server) => (
										<div
											key={server.name}
											className="rounded-lg border border-separator bg-surface-secondary px-3 py-2"
										>
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-2">
													<CpuChipIcon className="size-4 text-accent" />
													<span className="font-medium text-sm">
														{server.name}
													</span>
												</div>
												<Chip size="sm" variant="soft">
													{server.transport_type}
												</Chip>
											</div>
											{server.url && (
												<p className="text-xs text-muted mt-2 truncate">
													{server.url}
												</p>
											)}
											{server.note && (
												<p className="text-xs text-muted mt-1">
													{server.note}
												</p>
											)}
										</div>
									))}
								</div>
							</div>
						)}
					</Card.Content>
				</Card>
			</div>
		</div>
	);
}

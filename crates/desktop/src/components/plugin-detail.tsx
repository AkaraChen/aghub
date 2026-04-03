"use client";

import {
	BoltIcon,
	FolderOpenIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Chip, Switch, Tooltip } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
		allSkills?.filter((skill) => skill.plugin_id && skill.plugin_id === currentPlugin?.id) ?? [];

	const hooks = pluginDetail?.hooks;
	const mcpConfig = pluginDetail?.mcp_config;

	const handleOpenInstallPath = () => {
		if (currentPlugin.install_path) {
			api.skills
				.openFolder(currentPlugin.install_path)
				.catch(console.error);
		}
	};

	// Multi-select mode shows summary
	if (selectedCount > 1) {
		return (
			<Card className="h-full border-none shadow-none flex flex-col bg-transparent">
				<Card.Header className="flex-col items-stretch gap-4 border-b border-separator p-5 sm:p-6 pb-4">
					<h2 className="text-xl font-semibold text-foreground">
						{t("itemsSelected", { count: selectedCount })}
					</h2>
				</Card.Header>
				<Card.Content className="flex-1 overflow-y-auto p-0 scrollbar-thin">
					<div className="flex flex-col gap-6 p-5 sm:p-6">
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
												className={`size-2.5 rounded-full shadow-inner ${p.enabled ? "bg-success" : "bg-default-300"}`}
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
					</div>
				</Card.Content>
			</Card>
		);
	}

	return (
		<Card className="h-full border-none shadow-none flex flex-col bg-transparent">
			{/* Header: Name + Version + Enable Switch */}
			<Card.Header className="flex-col items-stretch gap-4 border-b border-separator p-5 sm:p-6 pb-4">
				<div className="flex w-full items-start justify-between gap-4">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<h2 className="text-xl font-semibold tracking-tight text-foreground truncate">
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
					<div className="flex shrink-0 items-center justify-end">
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
					</div>
				</div>
			</Card.Header>

			<Card.Content className="flex-1 overflow-y-auto p-0 scrollbar-thin">
				<div className="flex flex-col gap-6 p-5 sm:p-6">
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


						{/* Plugin Skills */}
						{(pluginSkills.length > 0 ||
							(pluginDetail?.provided_skills?.length ?? 0) >
								0) && (
							<div className="space-y-3">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providedSkills")}
								</h3>
								<div className="space-y-2">
									{pluginSkills.length > 0
										? pluginSkills.map((skill) => {
												const skillPath = `${currentPlugin.install_path}/skills/${skill.name}`;
												return (
													<div
														key={skill.name}
														className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2"
													>
														<div className="min-w-0 flex-1">
															<div className="flex items-center gap-2">
																<p
																	tabIndex={0}
																	className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
																	title={skillPath}
																>
																	{skillPath}
																</p>
															</div>
															<p className="mt-0.5 text-[11px] text-muted truncate">
																{skill.name} {skill.description && `- ${skill.description}`}
															</p>
														</div>
														<div className="flex shrink-0 items-center gap-1">
															<Tooltip delay={0}>
																<Button
																	isIconOnly
																	variant="ghost"
																	size="sm"
																	className="size-8 text-muted"
																	aria-label={t("openFolder")}
																	onPress={() => api.skills.openFolder(skillPath).catch(console.error)}
																>
																	<FolderOpenIcon className="size-4" />
																</Button>
																<Tooltip.Content>{t("openFolder")}</Tooltip.Content>
															</Tooltip>
														</div>
													</div>
												);
										  })
										: pluginDetail?.provided_skills?.map(
												(skillName) => {
													const skillPath = `${currentPlugin.install_path}/skills/${skillName}`;
													return (
														<div
															key={skillName}
															className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2 opacity-60"
														>
															<div className="min-w-0 flex-1">
																<div className="flex items-center gap-2">
																	<p
																		tabIndex={0}
																		className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
																		title={skillPath}
																	>
																		{skillPath}
																	</p>
																</div>
																<p className="mt-0.5 text-[11px] text-muted truncate">
																	{skillName} - {t("pluginDisabledDescription") ?? "Enable plugin to load metadata"}
																</p>
															</div>
															<div className="flex shrink-0 items-center gap-1">
																<Tooltip delay={0}>
																	<Button
																		isIconOnly
																		variant="ghost"
																		size="sm"
																		className="size-8 text-muted"
																		aria-label={t("openFolder")}
																		onPress={() => api.skills.openFolder(skillPath).catch(console.error)}
																	>
																		<FolderOpenIcon className="size-4" />
																	</Button>
																	<Tooltip.Content>{t("openFolder")}</Tooltip.Content>
																</Tooltip>
															</div>
														</div>
													);
												},
										  )}
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
										<div className="flex items-center gap-2">
											<p
												tabIndex={0}
												className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
												title={currentPlugin.install_path}
											>
												{currentPlugin.install_path}
											</p>
										</div>
										<p className="mt-0.5 text-[11px] text-muted">
											{t("installPath")} &bull; {t("source")}: {currentPlugin.source}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										<Tooltip delay={0}>
											<Button
												isIconOnly
												variant="ghost"
												size="sm"
												className="size-8 text-muted"
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
											className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2"
										>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<p
														tabIndex={0}
														className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none flex items-center gap-1.5"
													>
														<BoltIcon className="size-3.5 text-warning" />
														{event.event}
													</p>
												</div>
												<div className="mt-0.5 text-[11px] text-muted truncate">
													{event.matchers.map((matcher, idx) => (
														<span key={`${event.event}-${matcher.matcher ?? "all"}-${idx}`}>
															{matcher.matcher ? `Matcher: ${matcher.matcher}` : "All events"} ({matcher.hooks.length} hook(s))
															{idx < event.matchers.length - 1 ? ", " : ""}
														</span>
													))}
												</div>
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
									{mcpConfig.servers.map((server) => {
										const serverPath = currentPlugin.install_path;
										return (
											<div
												key={server.name}
												className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2"
											>
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-2">
														<p
															tabIndex={0}
															className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
															title={serverPath}
														>
															{serverPath}
														</p>
													</div>
													<div className="mt-0.5 flex items-center gap-2">
														<p className="text-[11px] text-muted truncate">
															{server.name} {server.note && `- ${server.note}`}
														</p>
														<Chip size="sm" variant="soft" className="h-[14px] px-1 text-[9px]">
															{server.transport_type}
														</Chip>
													</div>
												</div>
												<div className="flex shrink-0 items-center gap-1">
													<Tooltip delay={0}>
														<Button
															isIconOnly
															variant="ghost"
															size="sm"
															className="size-8 text-muted"
															onPress={() => api.skills.openFolder(serverPath).catch(console.error)}
															aria-label={t("openFolder")}
														>
															<FolderOpenIcon className="size-4" />
														</Button>
														<Tooltip.Content>{t("openFolder")}</Tooltip.Content>
													</Tooltip>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						)}
				</div>
			</Card.Content>
		</Card>
	);
}

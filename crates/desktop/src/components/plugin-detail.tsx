"use client";

import {
	ArrowDownTrayIcon,
	ArrowPathIcon,
	CodeBracketIcon,
	FolderIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	AlertDialog,
	Button,
	Card,
	Chip,
	Switch,
	Tooltip,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as pathe from "pathe";
import { useMemo, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { siGithub } from "simple-icons";
import type {
	MarketPluginResponse,
	PluginDetailResponse,
	PluginListResponse,
	PluginResponse,
} from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";
import { skillListQueryOptions } from "../requests/skills";

interface PluginDetailProps {
	plugin: PluginResponse;
	selectedScope?: "user" | "project" | "local" | null;
	onScopeChange?: (scope: "user" | "project" | "local") => void;
}

function MetaRow({
	label,
	value,
	mono = false,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	const displayValue =
		value.length > 200 ? `${value.slice(0, 200)}...` : value;

	return (
		<div className="grid gap-1.5 py-1">
			<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
				{label}
			</span>
			<span
				className={cn(
					"min-w-0 text-sm text-foreground",
					mono &&
						"overflow-x-auto rounded-md bg-surface-secondary px-3 py-2 font-mono text-xs leading-5 text-foreground",
				)}
				title={value.length > 200 ? value : undefined}
			>
				{displayValue}
			</span>
		</div>
	);
}

function CodeBlock({
	label,
	command,
	args,
}: {
	label: string;
	command: string;
	args?: string[];
}) {
	const commandLine =
		args && args.length > 0 ? `${command} ${args.join(" ")}` : command;

	return (
		<div className="grid gap-1.5">
			<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
				{label}
			</span>
			<div className="overflow-x-auto rounded-lg border border-separator bg-surface-secondary px-3 py-2">
				<code className="block font-mono text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
					{commandLine}
				</code>
			</div>
		</div>
	);
}

interface PluginDetailUiState {
	showUninstallConfirm: boolean;
	showReinstallConfirm: boolean;
}

type PluginDetailUiAction =
	| { type: "set_uninstall_dialog"; value: boolean }
	| { type: "set_reinstall_dialog"; value: boolean };

function pluginDetailUiReducer(
	state: PluginDetailUiState,
	action: PluginDetailUiAction,
): PluginDetailUiState {
	switch (action.type) {
		case "set_uninstall_dialog":
			return { ...state, showUninstallConfirm: action.value };
		case "set_reinstall_dialog":
			return { ...state, showReinstallConfirm: action.value };
	}
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
	selectedScope = null,
	onScopeChange,
}: PluginDetailProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [uiState, dispatch] = useReducer(pluginDetailUiReducer, {
		showUninstallConfirm: false,
		showReinstallConfirm: false,
	});

	const { data: allSkills } = useQuery({
		...skillListQueryOptions({ api, scope: "global" }),
	});

	const { data: pluginDetail } = useQuery({
		...pluginDetailQueryOptions(api, plugin.id),
	});

	const currentPlugin = pluginDetail ?? plugin;
	const mcpConfig = pluginDetail?.mcp_config;
	const updateAvailable = pluginDetail?.update_available ?? false;
	const latestVersion = pluginDetail?.latest_version ?? null;

	const currentScope = useMemo(() => {
		if (
			selectedScope &&
			currentPlugin.scopes.some((scope) => scope.scope === selectedScope)
		) {
			return selectedScope;
		}

		return (
			currentPlugin.scopes.find(
				(scope) => scope.install_path === currentPlugin.install_path,
			)?.scope ??
			currentPlugin.scopes[0]?.scope ??
			"user"
		);
	}, [selectedScope, currentPlugin.install_path, currentPlugin.scopes]);

	const providedSkills = useMemo(
		() => pluginDetail?.provided_skills ?? [],
		[pluginDetail?.provided_skills],
	);

	const updatePluginCaches = (
		updater: (entry: PluginResponse) => PluginResponse,
	) => {
		queryClient.setQueryData<PluginListResponse | undefined>(
			["plugins"],
			(existing) =>
				existing
					? {
							...existing,
							plugins: existing.plugins.map((entry) =>
								entry.id === plugin.id ? updater(entry) : entry,
							),
						}
					: existing,
		);
		queryClient.setQueryData<PluginDetailResponse | undefined>(
			["plugin-detail", plugin.id],
			(existing) =>
				existing
					? {
							...existing,
							...updater(existing),
						}
					: existing,
		);
		queryClient.setQueryData<MarketPluginResponse[] | undefined>(
			["plugins-market"],
			(existing) =>
				existing?.map((entry) =>
					entry.id === plugin.id
						? { ...entry, enabled: updater(currentPlugin).enabled }
						: entry,
				) ?? existing,
		);
	};

	const markSkillQueriesStale = () =>
		queryClient.invalidateQueries({
			queryKey: ["skills"],
			refetchType: "none",
		});

	const applyPluginEnabledState = (enabled: boolean) => {
		updatePluginCaches((entry) => ({
			...entry,
			enabled,
		}));
	};

	const enableMutation = useMutation({
		mutationFn: (id: string) => api.plugins.enable(id),
		onMutate: async () => {
			await Promise.all([
				queryClient.cancelQueries({ queryKey: ["plugins"] }),
				queryClient.cancelQueries({
					queryKey: ["plugin-detail", plugin.id],
				}),
				queryClient.cancelQueries({ queryKey: ["plugins-market"] }),
			]);

			const previousPlugins =
				queryClient.getQueryData<PluginListResponse>(["plugins"]);
			const previousDetail =
				queryClient.getQueryData<PluginDetailResponse>([
					"plugin-detail",
					plugin.id,
				]);
			const previousMarket = queryClient.getQueryData<
				MarketPluginResponse[]
			>(["plugins-market"]);

			applyPluginEnabledState(true);

			return {
				previousPlugins,
				previousDetail,
				previousMarket,
			};
		},
		onSuccess: (data) => {
			updatePluginCaches((entry) => ({
				...entry,
				...data,
			}));
			void markSkillQueriesStale();
		},
		onError: (_error, _variables, context) => {
			queryClient.setQueryData(["plugins"], context?.previousPlugins);
			queryClient.setQueryData(
				["plugin-detail", plugin.id],
				context?.previousDetail,
			);
			queryClient.setQueryData(
				["plugins-market"],
				context?.previousMarket,
			);
		},
	});

	const disableMutation = useMutation({
		mutationFn: (id: string) => api.plugins.disable(id),
		onMutate: async () => {
			await Promise.all([
				queryClient.cancelQueries({ queryKey: ["plugins"] }),
				queryClient.cancelQueries({
					queryKey: ["plugin-detail", plugin.id],
				}),
				queryClient.cancelQueries({ queryKey: ["plugins-market"] }),
			]);

			const previousPlugins =
				queryClient.getQueryData<PluginListResponse>(["plugins"]);
			const previousDetail =
				queryClient.getQueryData<PluginDetailResponse>([
					"plugin-detail",
					plugin.id,
				]);
			const previousMarket = queryClient.getQueryData<
				MarketPluginResponse[]
			>(["plugins-market"]);

			applyPluginEnabledState(false);

			return {
				previousPlugins,
				previousDetail,
				previousMarket,
			};
		},
		onSuccess: (data) => {
			updatePluginCaches((entry) => ({
				...entry,
				...data,
			}));
			void markSkillQueriesStale();
		},
		onError: (_error, _variables, context) => {
			queryClient.setQueryData(["plugins"], context?.previousPlugins);
			queryClient.setQueryData(
				["plugin-detail", plugin.id],
				context?.previousDetail,
			);
			queryClient.setQueryData(
				["plugins-market"],
				context?.previousMarket,
			);
		},
	});

	const isToggling = enableMutation.isPending || disableMutation.isPending;

	const updateMutation = useMutation({
		mutationFn: (pluginId: string) =>
			api.plugins.update({
				plugin_id: pluginId,
				scope: currentScope,
			}),
		onSuccess: () => {
			toast.success(t("pluginUpdated"));
			queryClient.invalidateQueries({ queryKey: ["plugins"] });
			queryClient.invalidateQueries({
				queryKey: ["plugin-detail", plugin.id],
			});
		},
		onError: (error) => {
			toast.danger(error.message || t("updateFailed"));
		},
	});

	const reinstallMutation = useMutation({
		mutationFn: (pluginId: string) =>
			api.plugins.reinstall({
				plugin_id: pluginId,
				scope: currentScope,
				keep_data: true,
			}),
		onSuccess: () => {
			toast.success(t("pluginReinstalled"));
			queryClient.invalidateQueries({ queryKey: ["plugins"] });
			queryClient.invalidateQueries({
				queryKey: ["plugin-detail", plugin.id],
			});
		},
		onError: (error) => {
			toast.danger(error.message || t("reinstallFailed"));
		},
	});

	const uninstallMutation = useMutation({
		mutationFn: (pluginId: string) =>
			api.plugins.uninstall({
				plugin_id: pluginId,
				scope: currentScope,
				keep_data: false,
			}),
		onSuccess: () => {
			toast.success(t("pluginUninstalled"));
			queryClient.invalidateQueries({ queryKey: ["plugins"] });
		},
		onError: (error) => {
			toast.danger(error.message || t("uninstallFailed"));
		},
	});

	const handleUninstall = () => {
		dispatch({ type: "set_uninstall_dialog", value: false });
		uninstallMutation.mutate(currentPlugin.id);
	};

	const handleReinstall = () => {
		dispatch({ type: "set_reinstall_dialog", value: false });
		reinstallMutation.mutate(currentPlugin.id);
	};

	const handleOpenUrl = (url: string | undefined) => {
		if (url) {
			openUrl(url).catch(console.error);
		}
	};

	const handleOpenInstallPath = () => {
		// Use API to open folder (same as skill folder opening)
		api.skills.openFolder(currentPlugin.install_path).catch(console.error);
	};

	// Merge plugin skills from allSkills with provided_skills from API
	// Use Set to deduplicate by skill name
	const allPluginSkills = useMemo(() => {
		const pluginSkills =
			allSkills?.filter(
				(skill) =>
					skill.plugin_id && skill.plugin_id === currentPlugin?.id,
			) ?? [];
		const skillNames = new Set(pluginSkills.map((s) => s.name));
		const merged = [...pluginSkills];
		for (const skill of providedSkills) {
			if (!skillNames.has(skill.name)) {
				merged.push({
					name: skill.name,
					description: skill.description,
				} as unknown as (typeof pluginSkills)[0]);
			}
		}
		return merged;
	}, [allSkills, currentPlugin.id, providedSkills]);

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full space-y-4 p-4 sm:p-6">
				<Card>
					{/* Header: Name + Version + Actions */}
					<Card.Header className="flex flex-row items-start justify-between gap-3">
						<div className="min-w-0 flex-1">
							<h2 className="text-xl font-semibold text-foreground truncate flex items-center gap-2">
								{currentPlugin.name}
								{currentPlugin.scopes.length > 1 && (
									<select
										className="bg-default-100 text-foreground text-xs rounded px-2 py-1 outline-none font-normal border border-default-200 ml-2"
										value={currentScope}
										onChange={(e) =>
											onScopeChange?.(
												e.target.value as
													| "user"
													| "project"
													| "local",
											)
										}
									>
										{currentPlugin.scopes.map((s) => (
											<option
												key={s.scope}
												value={s.scope}
											>
												{s.scope}
											</option>
										))}
									</select>
								)}
							</h2>
							<p className="text-xs text-muted mt-1">
								{currentPlugin.id}
							</p>
						</div>
						<div className="flex items-center gap-1">
							{(currentPlugin.source ===
								"claude-plugins-official" ||
								currentPlugin.source.startsWith("http")) && (
								<>
									{/* Update button (shown when update available) */}
									{updateAvailable && (
										<Tooltip delay={0}>
											<Button
												isIconOnly
												variant="ghost"
												size="sm"
												className="size-8 text-success"
												onPress={() =>
													updateMutation.mutate(
														currentPlugin.id,
													)
												}
												isDisabled={
													updateMutation.isPending
												}
												aria-label={t("updatePlugin")}
											>
												<ArrowDownTrayIcon
													className={`size-4 ${updateMutation.isPending ? "animate-bounce" : ""}`}
												/>
											</Button>
											<Tooltip.Content>
												{latestVersion
													? t("updateToVersion", {
															version:
																latestVersion,
														})
													: t("updatePlugin")}
											</Tooltip.Content>
										</Tooltip>
									)}
									{/* Reinstall */}
									<Tooltip delay={0}>
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											className="size-8 text-muted"
											onPress={() =>
												dispatch({
													type: "set_reinstall_dialog",
													value: true,
												})
											}
											isDisabled={
												reinstallMutation.isPending
											}
											aria-label={t("reinstallPlugin")}
										>
											<ArrowPathIcon
												className={`size-4 ${reinstallMutation.isPending ? "animate-spin" : ""}`}
											/>
										</Button>
										<Tooltip.Content>
											{t("reinstallPlugin")}
										</Tooltip.Content>
									</Tooltip>
								</>
							)}
							{/* Uninstall */}
							<Tooltip delay={0}>
								<Button
									isIconOnly
									variant="ghost"
									size="sm"
									className="size-8 text-muted"
									onPress={() =>
										dispatch({
											type: "set_uninstall_dialog",
											value: true,
										})
									}
									isDisabled={uninstallMutation.isPending}
									aria-label={t("uninstallPlugin")}
								>
									<TrashIcon
										className={`size-4 ${uninstallMutation.isPending ? "animate-spin" : ""}`}
									/>
								</Button>
								<Tooltip.Content>
									{t("uninstallPlugin")}
								</Tooltip.Content>
							</Tooltip>
							<Tooltip delay={0}>
								<Switch
									isSelected={currentPlugin.enabled}
									isDisabled={isToggling}
									onChange={() => {
										if (currentPlugin.enabled) {
											disableMutation.mutate(
												currentPlugin.id,
											);
										} else {
											enableMutation.mutate(
												currentPlugin.id,
											);
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
								<Tooltip.Content>
									{currentPlugin.enabled
										? t("disablePlugin")
										: t("enablePlugin")}
								</Tooltip.Content>
							</Tooltip>
						</div>
					</Card.Header>

					<Card.Content className="flex flex-col gap-6">
						{/* Description */}
						{currentPlugin.description && (
							<div className="space-y-2">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("description")}
								</h3>
								<p className="text-sm text-foreground">
									{currentPlugin.description}
								</p>
							</div>
						)}

						{/* Plugin Source */}
						<div className="space-y-3">
							<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
								{t("installedFrom")}
							</h3>
							<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-1.5">
										<svg
											role="img"
											className="size-3.5 shrink-0 text-muted"
											viewBox="0 0 24 24"
											fill="currentColor"
										>
											<path d={siGithub.path} />
										</svg>
										<span className="min-w-0 truncate text-sm text-foreground">
											{currentPlugin.source}
										</span>
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<Tooltip delay={0}>
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											className="size-8 text-muted"
											aria-label={t("openRepository")}
											isDisabled={
												!currentPlugin.repository
											}
											onPress={() =>
												handleOpenUrl(
													currentPlugin.repository,
												)
											}
										>
											<CodeBracketIcon className="size-4" />
										</Button>
										<Tooltip.Content>
											{t("openRepository")}
										</Tooltip.Content>
									</Tooltip>
								</div>
							</div>
						</div>

						{/* Plugin Info */}
						<div className="space-y-4">
							<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
								{t("pluginInfo")}
							</h3>
							{/* Install Path with open button */}
							<div className="space-y-1.5">
								<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
									{t("installPath")}
								</span>
								<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
									<div className="min-w-0 flex-1">
										<p
											tabIndex={0}
											className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
											title={currentPlugin.install_path}
										>
											{pathe.dirname(
												currentPlugin.install_path,
											)}
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
												aria-label={t("openFolder")}
											>
												<FolderIcon className="size-4" />
											</Button>
											<Tooltip.Content>
												{t("openFolder")}
											</Tooltip.Content>
										</Tooltip>
									</div>
								</div>
							</div>
						</div>

						{/* Provided Skills - show all skills from plugin */}
						{allPluginSkills.length > 0 && (
							<div className="space-y-3">
								<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
									{t("providedSkills")}
								</h3>
								<div className="space-y-2">
									{allPluginSkills.map((skill) => (
										<div
											key={skill.name}
											className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2"
										>
											<div className="min-w-0 flex-1">
												<p className="font-mono text-xs text-foreground truncate">
													{skill.name}
												</p>
												{skill.description && (
													<p className="text-[11px] text-muted truncate">
														{skill.description}
													</p>
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
								<div className="space-y-3">
									{mcpConfig.servers.map((server) => (
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
											{server.env &&
												Object.keys(server.env).length >
													0 && (
													<div className="grid gap-1.5 pt-1">
														<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
															{t(
																"environmentVariables",
															) ||
																"Environment Variables"}
														</span>
														<div className="space-y-2">
															{Object.entries(
																server.env,
															).map(
																([
																	key,
																	value,
																]) => (
																	<div
																		key={
																			key
																		}
																		className="grid gap-1 rounded-lg border border-separator bg-surface-secondary px-3 py-2"
																	>
																		<span className="font-mono text-[11px] text-muted">
																			{
																				key
																			}
																		</span>
																		<code className="font-mono text-xs leading-5 text-foreground break-words">
																			{
																				value as string
																			}
																		</code>
																	</div>
																),
															)}
														</div>
													</div>
												)}
											{server.url && (
												<MetaRow
													label="URL"
													value={server.url}
													mono
												/>
											)}
										</div>
									))}
								</div>
							</div>
						)}
					</Card.Content>
				</Card>

				{/* Uninstall Confirm Dialog */}
				<AlertDialog.Backdrop
					isOpen={uiState.showUninstallConfirm}
					onOpenChange={(open) =>
						dispatch({ type: "set_uninstall_dialog", value: open })
					}
				>
					<AlertDialog.Container>
						<AlertDialog.Dialog className="sm:max-w-[420px]">
							<AlertDialog.Header>
								<AlertDialog.Icon status="danger" />
								<AlertDialog.Heading>
									{t("confirmUninstallTitle")}
								</AlertDialog.Heading>
							</AlertDialog.Header>
							<AlertDialog.Body>
								<p className="text-sm text-muted">
									{t("confirmUninstallDescription", {
										name: currentPlugin.name,
									})}
								</p>
							</AlertDialog.Body>
							<AlertDialog.Footer>
								<Button
									variant="tertiary"
									onPress={() =>
										dispatch({
											type: "set_uninstall_dialog",
											value: false,
										})
									}
								>
									{t("cancel")}
								</Button>
								<Button
									variant="primary"
									onPress={handleUninstall}
								>
									{t("uninstall")}
								</Button>
							</AlertDialog.Footer>
						</AlertDialog.Dialog>
					</AlertDialog.Container>
				</AlertDialog.Backdrop>

				{/* Reinstall Confirm Dialog */}
				<AlertDialog.Backdrop
					isOpen={uiState.showReinstallConfirm}
					onOpenChange={(open) =>
						dispatch({ type: "set_reinstall_dialog", value: open })
					}
				>
					<AlertDialog.Container>
						<AlertDialog.Dialog className="sm:max-w-[420px]">
							<AlertDialog.Header>
								<AlertDialog.Icon status="warning" />
								<AlertDialog.Heading>
									{t("confirmReinstallTitle")}
								</AlertDialog.Heading>
							</AlertDialog.Header>
							<AlertDialog.Body>
								<p className="text-sm text-muted">
									{t("confirmReinstallDescription", {
										name: currentPlugin.name,
									})}
								</p>
							</AlertDialog.Body>
							<AlertDialog.Footer>
								<Button
									variant="tertiary"
									onPress={() =>
										dispatch({
											type: "set_reinstall_dialog",
											value: false,
										})
									}
								>
									{t("cancel")}
								</Button>
								<Button onPress={handleReinstall}>
									{t("reinstall")}
								</Button>
							</AlertDialog.Footer>
						</AlertDialog.Dialog>
					</AlertDialog.Container>
				</AlertDialog.Backdrop>
			</div>
		</div>
	);
}

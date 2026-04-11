"use client";

import { FolderIcon } from "@heroicons/react/24/solid";
import { Card, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	CCPluginCheckUpdateResponse,
	CCPluginResponse,
} from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { queryKeys } from "../requests/keys";
import {
	checkPluginUpdateMutationOptions,
	pluginDetailQueryOptions,
	pluginUpdateStatusQueryOptions,
	reinstallPluginMutationOptions,
	uninstallPluginMutationOptions,
	updatePluginMutationOptions,
} from "../requests/plugins";
import { skillListQueryOptions } from "../requests/skills";
import { McpServersSection } from "./plugin-detail/mcp-servers-section";
import { PluginConfirmDialog } from "./plugin-detail/confirm-dialog";
import { PluginDetailHeader } from "./plugin-detail/detail-header";
import { ProvidedSkillsSection } from "./plugin-detail/provided-skills-section";
import { PluginSourceCard } from "./plugin-detail/source-card";
import { usePluginToggleState } from "./plugin-detail/use-plugin-toggle-state";
import { TooltipIconButton } from "./ui/tooltip-icon-button";

const SEMANTIC_VERSION_REGEX = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const GIT_HASH_REGEX = /^[0-9a-f]{7,40}$/i;

type PluginScopeValue = "user" | "project" | "local";

interface PluginDetailProps {
	plugin: CCPluginResponse;
	selectedScope?: PluginScopeValue | null;
	onScopeChange?: (scope: PluginScopeValue) => void;
}

export function PluginDetail({
	plugin,
	selectedScope = null,
	onScopeChange,
}: PluginDetailProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
	const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);

	const { data: allSkills } = useQuery(
		skillListQueryOptions({ api, scope: "global" }),
	);

	const { data: pluginDetail } = useQuery(
		pluginDetailQueryOptions({
			api,
			pluginId: plugin.id,
		}),
	);

	const currentPlugin = pluginDetail ?? plugin;
	const mcpConfig = pluginDetail?.mcp_config;

	const currentScope = useMemo(() => {
		if (
			selectedScope &&
			currentPlugin.scopes.some((scope) => scope.scope === selectedScope)
		) {
			return selectedScope;
		}

		return (currentPlugin.scopes[0]?.scope ?? "user") as PluginScopeValue;
	}, [selectedScope, currentPlugin.scopes]);

	const currentScopeInfo = useMemo(
		() =>
			currentPlugin.scopes.find(
				(scope) => scope.scope === currentScope,
			) ??
			currentPlugin.scopes[0] ??
			null,
		[currentPlugin.scopes, currentScope],
	);

	const canCheckUpdates = currentPlugin.source_info.can_check_updates;

	const { data: updateStatus } = useQuery(
		pluginUpdateStatusQueryOptions({
			api,
			pluginId: currentPlugin.id,
			scope: currentScope,
			enabled: canCheckUpdates,
		}),
	);

	const updateAvailable = updateStatus?.update_available ?? false;
	const latestVersion = updateStatus?.latest_version ?? null;

	const providedSkills = useMemo(
		() => pluginDetail?.provided_skills ?? [],
		[pluginDetail?.provided_skills],
	);

	const sourceVersion = useMemo(() => {
		const version =
			currentScopeInfo?.version?.trim() || currentPlugin.version?.trim();
		if (!version) {
			return null;
		}

		if (version === "latest") {
			return "latest";
		}

		if (version.startsWith("v")) {
			return version;
		}

		if (GIT_HASH_REGEX.test(version)) {
			return `#${version}`;
		}

		if (SEMANTIC_VERSION_REGEX.test(version)) {
			return `v${version}`;
		}

		return version;
	}, [currentPlugin.version, currentScopeInfo?.version]);

	const markSkillQueriesStale = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.skills.all(),
			refetchType: "none",
		});

	const { enableMutation, disableMutation, isToggling } =
		usePluginToggleState({
			api,
			queryClient,
			pluginId: plugin.id,
			currentPlugin,
			onSkillsChanged: markSkillQueriesStale,
		});

	const updateMutation = useMutation({
		...updatePluginMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("pluginUpdated"));
			},
		}),
		onError: (error) => {
			toast.danger(error.message || t("updateFailed"));
		},
	});

	const checkUpdateMutation = useMutation({
		...checkPluginUpdateMutationOptions({ api }),
		onSuccess: (data) => {
			queryClient.setQueryData<CCPluginCheckUpdateResponse>(
				queryKeys.plugins.updateStatus(plugin.id, currentScope),
				data,
			);

			void queryClient.invalidateQueries({
				queryKey: queryKeys.plugins.list(),
			});

			if (data.update_available) {
				toast.success(
					t("updateAvailable", {
						version: data.latest_version ?? "latest",
					}),
				);
			} else {
				toast.success(t("noUpdateAvailable"));
			}
		},
		onError: (error) => {
			toast.danger(
				t("updateCheckFailed", {
					error: error.message || t("unknownError"),
				}),
			);
		},
	});

	const reinstallMutation = useMutation({
		...reinstallPluginMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("pluginReinstalled"));
			},
		}),
		onError: (error) => {
			toast.danger(error.message || t("reinstallFailed"));
		},
	});

	const uninstallMutation = useMutation({
		...uninstallPluginMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("pluginUninstalled"));
			},
		}),
		onError: (error) => {
			toast.danger(error.message || t("uninstallFailed"));
		},
	});

	const handleUninstall = () => {
		setShowUninstallConfirm(false);
		uninstallMutation.mutate({
			plugin_id: currentPlugin.id,
			scope: currentScope,
			keep_data: false,
		});
	};

	const handleReinstall = () => {
		setShowReinstallConfirm(false);
		reinstallMutation.mutate({
			plugin_id: currentPlugin.id,
			scope: currentScope,
			keep_data: true,
		});
	};

	const handleSourceRefresh = () => {
		if (updateAvailable) {
			updateMutation.mutate({
				plugin_id: currentPlugin.id,
				scope: currentScope,
			});
			return;
		}

		checkUpdateMutation.mutate({
			plugin_id: currentPlugin.id,
			scope: currentScope,
		});
	};

	const handleOpenUrl = (url: string | undefined) => {
		if (url) {
			openUrl(url).catch(console.error);
		}
	};

	const handleOpenInstallPath = () => {
		api.plugins
			.openFolder(currentPlugin.id, currentScope)
			.catch(console.error);
	};

	const allPluginSkills = useMemo(() => {
		const pluginSkills =
			allSkills?.filter(
				(skill) =>
					skill.plugin_id && skill.plugin_id === currentPlugin.id,
			) ?? [];
		const skillNames = new Set(pluginSkills.map((skill) => skill.name));
		const merged = [...pluginSkills];

		for (const skill of providedSkills) {
			if (!skillNames.has(skill.name)) {
				merged.push({
					name: skill.name,
					description: skill.description,
				} as (typeof merged)[number]);
			}
		}

		return merged;
	}, [allSkills, currentPlugin.id, providedSkills]);

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full space-y-4 p-4 sm:p-6">
				<Card variant="secondary">
					<PluginDetailHeader
						plugin={currentPlugin}
						currentScope={currentScope}
						isToggling={isToggling}
						isReinstalling={reinstallMutation.isPending}
						isUninstalling={uninstallMutation.isPending}
						onScopeChange={onScopeChange}
						onReinstall={() => setShowReinstallConfirm(true)}
						onUninstall={() => setShowUninstallConfirm(true)}
						onToggle={() => {
							if (currentPlugin.enabled) {
								disableMutation.mutate(currentPlugin.id);
								return;
							}

							enableMutation.mutate(currentPlugin.id);
						}}
					/>

					<Card.Content className="flex flex-col gap-6">
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

						<PluginSourceCard
							sourceLabel={currentPlugin.source_info.label}
							sourceVersion={sourceVersion}
							sourceUrl={currentPlugin.source_info.url ?? null}
							isGitHubSource={currentPlugin.source_info.is_github}
							canCheckUpdates={
								currentPlugin.source_info.can_check_updates
							}
							updateAvailable={updateAvailable}
							latestVersion={latestVersion}
							isUpdating={
								updateMutation.isPending ||
								checkUpdateMutation.isPending
							}
							onRefresh={handleSourceRefresh}
							onOpenUrl={handleOpenUrl}
						/>

						<div className="space-y-4">
							<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
								{t("pluginInfo")}
							</h3>
							<div className="space-y-1.5">
								<span className="text-[11px] font-medium tracking-wide text-muted uppercase">
									{t("installPath")}
								</span>
								<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
									<div className="min-w-0 flex-1">
										<p
											tabIndex={0}
											className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
											title={
												currentScopeInfo?.folder_path ??
												currentPlugin.install_path
											}
										>
											{currentScopeInfo?.folder_path ??
												currentPlugin.install_path}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										<TooltipIconButton
											variant="ghost"
											size="sm"
											className="size-8 text-muted"
											onPress={handleOpenInstallPath}
											label={t("openFolder")}
										>
											<FolderIcon className="size-4" />
										</TooltipIconButton>
									</div>
								</div>
							</div>
						</div>

						<ProvidedSkillsSection skills={allPluginSkills} />
						<McpServersSection config={mcpConfig} />
					</Card.Content>
				</Card>

				<PluginConfirmDialog
					isOpen={showUninstallConfirm}
					title={t("confirmUninstallTitle")}
					description={t("confirmUninstallDescription", {
						name: currentPlugin.name,
					})}
					confirmLabel={t("uninstall")}
					cancelLabel={t("cancel")}
					status="danger"
					onOpenChange={setShowUninstallConfirm}
					onConfirm={handleUninstall}
				/>
				<PluginConfirmDialog
					isOpen={showReinstallConfirm}
					title={t("confirmReinstallTitle")}
					description={t("confirmReinstallDescription", {
						name: currentPlugin.name,
					})}
					confirmLabel={t("reinstall")}
					cancelLabel={t("cancel")}
					status="warning"
					onOpenChange={setShowReinstallConfirm}
					onConfirm={handleReinstall}
				/>
			</div>
		</div>
	);
}

"use client";

import { FolderIcon } from "@heroicons/react/24/solid";
import { Button, Card, Tooltip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CCPluginResponse } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import {
	pluginDetailQueryOptions,
	pluginUpdateStatusQueryOptions,
} from "../requests/plugins";
import { McpServersSection } from "./plugin-detail/mcp-servers-section";
import { PluginConfirmDialog } from "./plugin-detail/confirm-dialog";
import { PluginDetailHeader } from "./plugin-detail/detail-header";
import { ProvidedSkillsSection } from "./plugin-detail/provided-skills-section";
import { PluginSourceCard } from "./plugin-detail/source-card";
import { usePluginDetailActions } from "./plugin-detail/use-plugin-detail-actions";

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
	const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
	const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);

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

	const providedSkills = pluginDetail?.provided_skills ?? [];

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
	const installPath =
		currentScopeInfo?.folder_path ??
		currentPlugin.scopes[0]?.folder_path ??
		"—";
	const {
		enableMutation,
		disableMutation,
		isToggling,
		updateMutation,
		checkUpdateMutation,
		reinstallMutation,
		uninstallMutation,
		handleSourceRefresh,
		handleReinstall,
		handleUninstall,
		handleOpenUrl,
		handleOpenInstallPath,
	} = usePluginDetailActions({
		pluginId: plugin.id,
		currentPlugin,
		currentScope,
		currentScopeInfo,
		updateAvailable,
		latestVersion,
	});
	const confirmUninstall = () => {
		setShowUninstallConfirm(false);
		handleUninstall();
	};
	const confirmReinstall = () => {
		setShowReinstallConfirm(false);
		handleReinstall();
	};

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
								<div className="flex items-center justify-between gap-3 rounded-lg border border-separator bg-surface-secondary px-3 py-2">
									<div className="min-w-0 flex-1">
										<p
											tabIndex={0}
											className="cursor-default break-all rounded-sm font-mono text-xs text-foreground focus:ring-2 focus:ring-offset-2 focus:outline-none"
											title={installPath}
										>
											{installPath}
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
												onPress={handleOpenInstallPath}
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

						<ProvidedSkillsSection skills={providedSkills} />
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
					onConfirm={confirmUninstall}
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
					onConfirm={confirmReinstall}
				/>
			</div>
		</div>
	);
}

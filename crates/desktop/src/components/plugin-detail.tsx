"use client";

import { FolderIcon } from "@heroicons/react/24/solid";
import { Button, Card, Tooltip, toast } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CCPluginResponse } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { useCurrentCodeEditor } from "../hooks/use-integrations";
import {
	openSkillInEditorMutationOptions,
	pluginDetailQueryOptions,
} from "../requests/plugins";
import { McpServersSection } from "./plugin-detail/mcp-servers-section";
import { PluginConfirmDialog } from "./plugin-detail/confirm-dialog";
import { PluginDetailHeader } from "./plugin-detail/detail-header";
import { ProvidedSkillsSection } from "./plugin-detail/provided-skills-section";
import { PluginSourceCard } from "./plugin-detail/source-card";
import { formatPluginVersion } from "../lib/plugin-version";
import { usePluginDetailActions } from "./plugin-detail/use-plugin-detail-actions";

type PluginScopeValue = "global" | "project" | "local";

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
	const { selectedEditor } = useCurrentCodeEditor();
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
	const displayScopeInfo = useMemo(
		() =>
			(currentPlugin.display_scope
				? currentPlugin.scopes.find(
						(scope) => scope.scope === currentPlugin.display_scope,
					)
				: null) ??
			currentPlugin.scopes[0] ??
			null,
		[currentPlugin.display_scope, currentPlugin.scopes],
	);

	const currentScope = useMemo(() => {
		if (
			selectedScope &&
			currentPlugin.scopes.some((scope) => scope.scope === selectedScope)
		) {
			return selectedScope;
		}

		return (displayScopeInfo?.scope ?? "global") as PluginScopeValue;
	}, [selectedScope, currentPlugin.scopes, displayScopeInfo]);

	const currentScopeInfo = useMemo(
		() =>
			currentPlugin.scopes.find(
				(scope) => scope.scope === currentScope,
			) ?? displayScopeInfo,
		[currentPlugin.scopes, currentScope, displayScopeInfo],
	);

	const providedSkills = pluginDetail?.provided_skills ?? [];
	const openProvidedSkillMutation = useMutation({
		...openSkillInEditorMutationOptions({
			api,
			onError: (error) => {
				toast.danger(t("editInEditor"), {
					description:
						error instanceof Error && error.message
							? error.message
							: t("unknownError"),
				});
			},
		}),
	});

	const sourceVersion = useMemo(() => {
		const version =
			currentScopeInfo?.version?.trim() || currentPlugin.version?.trim();
		if (!version) {
			return null;
		}
		return formatPluginVersion(version);
	}, [currentPlugin.version, currentScopeInfo?.version]);
	const installPath =
		currentScopeInfo?.folder_path ?? displayScopeInfo?.folder_path ?? "—";
	const {
		enableMutation,
		disableMutation,
		isToggling,
		updateMutation,
		reinstallMutation,
		uninstallMutation,
		handleUpdate,
		handleReinstall,
		handleUninstall,
		handleOpenUrl,
		handleOpenInstallPath,
	} = usePluginDetailActions({
		currentPlugin,
		currentScope,
		currentScopeInfo,
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
				<Card>
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
							<p className="text-sm text-foreground">
								{currentPlugin.description}
							</p>
						)}

						<PluginSourceCard
							sourceLabel={currentPlugin.source_info.label}
							sourceVersion={sourceVersion}
							sourceUrl={currentPlugin.source_info.url ?? null}
							isGitHubSource={currentPlugin.source_info.is_github}
							canUpdate={currentPlugin.source_info.can_reinstall}
							isUpdating={updateMutation.isPending}
							onUpdate={handleUpdate}
							onOpenUrl={handleOpenUrl}
						/>

						<div className="space-y-3">
							<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
								{t("pluginInfo")}
							</h3>
							<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
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

						<ProvidedSkillsSection
							skills={providedSkills}
							onEditSkill={
								selectedEditor
									? (skillName) =>
											openProvidedSkillMutation.mutate({
												plugin_id: currentPlugin.id,
												scope: currentScope,
												skill_name: skillName,
												editor: selectedEditor,
											})
									: undefined
							}
						/>
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

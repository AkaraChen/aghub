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
}

export function PluginDetail({ plugin }: PluginDetailProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const { data: allSkills } = useQuery({
		...skillListQueryOptions({ api, scope: "global" }),
	});

	const enableMutation = useMutation({
		mutationFn: (id: string) => api.plugins.enable(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["plugins"] });
			queryClient.invalidateQueries({ queryKey: ["skills"] });
		},
	});

	const disableMutation = useMutation({
		mutationFn: (id: string) => api.plugins.disable(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["plugins"] });
			queryClient.invalidateQueries({ queryKey: ["skills"] });
		},
	});

	// Filter skills that belong to this plugin
	const pluginSkills =
		allSkills?.filter((skill) => skill.plugin_id === plugin.id) ?? [];

	const handleOpenInstallPath = async () => {
		try {
			await openUrl(`file://${plugin.install_path}`);
		} catch {
			// Silent fail
		}
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full space-y-4 p-4 sm:p-6">
				<Card>
					<Card.Header className="flex flex-row items-start justify-between gap-3">
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<h2 className="text-xl font-semibold text-foreground truncate">
									{plugin.name}
								</h2>
								<span className="text-sm text-muted-foreground">
									v{plugin.version}
								</span>
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								{plugin.id}
							</p>
							{plugin.description && (
								<Card.Description className="mt-2">
									{plugin.description}
								</Card.Description>
							)}
						</div>
					</Card.Header>

					<Card.Content className="flex flex-col gap-6">
						{/* Enable/Disable Section */}
						<div className="flex items-center justify-between rounded-lg bg-surface-secondary px-4 py-3">
							<div className="flex items-center gap-3">
								<div
									className={`size-10 rounded-full flex items-center justify-center ${
										plugin.enabled
											? "bg-success/10 text-success"
											: "bg-muted/10 text-muted"
									}`}
								>
									<CpuChipIcon className="size-5" />
								</div>
								<div>
									<p className="font-medium text-foreground">
										{plugin.enabled
											? t("pluginEnabled")
											: t("pluginDisabled")}
									</p>
									<p className="text-xs text-muted-foreground">
										{plugin.enabled
											? t("pluginEnabledDescription")
											: t("pluginDisabledDescription")}
									</p>
								</div>
							</div>
							<Switch
								isSelected={plugin.enabled}
								onChange={() => {
									if (plugin.enabled) {
										disableMutation.mutate(plugin.id);
									} else {
										enableMutation.mutate(plugin.id);
									}
								}}
								aria-label={
									plugin.enabled
										? t("disablePlugin")
										: t("enablePlugin")
								}
							>
								<Switch.Control>
									<Switch.Thumb />
								</Switch.Control>
							</Switch>
						</div>

						{/* Capabilities */}
						<div className="space-y-3">
							<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
								{t("capabilities")}
							</h3>
							<div className="flex flex-wrap gap-2">
								{plugin.has_skills && (
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
								{plugin.has_hooks && (
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
								{!plugin.has_skills &&
									!plugin.has_hooks &&
									!plugin.has_mcp && (
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
								<div className="space-y-1.5">
									{pluginSkills.map((skill) => (
										<Card
											key={skill.name}
											className="p-3 bg-surface-secondary"
										>
											<div className="flex items-center justify-between">
												<div className="min-w-0">
													<p className="font-medium text-sm truncate">
														{skill.name}
													</p>
													{skill.description && (
														<p className="text-xs text-muted-foreground truncate">
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
										</Card>
									))}
								</div>
							</div>
						)}

						{/* Source & Installation */}
						<div className="space-y-3">
							<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
								{t("installationInfo")}
							</h3>
							<div className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span className="text-muted">
										{t("source")}
									</span>
									<span className="font-medium">
										{plugin.source}
									</span>
								</div>
								<div className="flex items-center gap-2">
									<code className="flex-1 text-xs bg-surface-secondary px-2 py-1.5 rounded font-mono truncate">
										{plugin.install_path}
									</code>
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
					</Card.Content>
				</Card>
			</div>
		</div>
	);
}

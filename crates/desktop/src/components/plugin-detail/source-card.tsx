"use client";

import { ArrowPathIcon, LinkIcon } from "@heroicons/react/24/solid";
import { Button, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { siGithub } from "simple-icons";
import { cn } from "../../lib/utils";

interface PluginSourceCardProps {
	sourceLabel: string;
	sourceVersion: string | null;
	sourceUrl: string | null;
	isGitHubSource: boolean;
	updateAvailable: boolean;
	latestVersion: string | null;
	isUpdating: boolean;
	onRefresh: () => void;
	onOpenUrl: (url: string | undefined) => void;
}

export function PluginSourceCard({
	sourceLabel,
	sourceVersion,
	sourceUrl,
	isGitHubSource,
	updateAvailable,
	latestVersion,
	isUpdating,
	onRefresh,
	onOpenUrl,
}: PluginSourceCardProps) {
	const { t } = useTranslation();

	return (
		<div className="space-y-3">
			<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
				{t("installedFrom")}
			</h3>
			<div className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-4 py-3">
				<div className="min-w-0 flex flex-1 items-center gap-3">
					{isGitHubSource ? (
						<svg
							role="img"
							className="size-4 shrink-0 text-muted"
							viewBox="0 0 24 24"
							fill="currentColor"
						>
							<path d={siGithub.path} />
						</svg>
					) : (
						<LinkIcon className="size-4 shrink-0 text-muted" />
					)}
					<div className="min-w-0 space-y-1">
						<p className="truncate text-sm font-medium text-foreground">
							{sourceLabel}
						</p>
						{sourceVersion && (
							<p className="text-xs text-muted">
								{sourceVersion}
							</p>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className={cn(
									"size-8 text-muted",
									updateAvailable && "text-success",
								)}
								aria-label={
									updateAvailable
										? t("updatePlugin")
										: t("checkForUpdates")
								}
								onPress={onRefresh}
								isDisabled={isUpdating}
							>
								<ArrowPathIcon
									className={cn(
										"size-4",
										isUpdating && "animate-spin",
									)}
								/>
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							{updateAvailable && latestVersion
								? t("updateToVersion", {
										version: latestVersion,
									})
								: t("checkForUpdates")}
						</Tooltip.Content>
					</Tooltip>
					<Tooltip delay={0}>
						<Tooltip.Trigger>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="size-8 text-muted"
								aria-label={t("openRepository")}
								isDisabled={!sourceUrl}
								onPress={() =>
									onOpenUrl(sourceUrl ?? undefined)
								}
							>
								<LinkIcon className="size-4" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>{t("openRepository")}</Tooltip.Content>
					</Tooltip>
				</div>
			</div>
		</div>
	);
}

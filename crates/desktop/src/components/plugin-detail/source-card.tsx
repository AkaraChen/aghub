"use client";

import {
	ArrowPathIcon,
	GlobeAltIcon,
	LinkIcon,
} from "@heroicons/react/24/solid";
import { Button, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { siGithub } from "simple-icons";

interface PluginSourceCardProps {
	sourceLabel: string;
	sourceVersion: string | null;
	sourceUrl: string | null;
	isGitHubSource: boolean;
	canCheckUpdates: boolean;
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
	canCheckUpdates,
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
			<div className="flex items-start justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2.5">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						{isGitHubSource ? (
							<svg
								role="img"
								className="size-3.5 shrink-0 text-muted"
								viewBox="0 0 24 24"
								fill="currentColor"
							>
								<path d={siGithub.path} />
							</svg>
						) : (
							<GlobeAltIcon className="size-3.5 shrink-0 text-muted" />
						)}
						<span className="min-w-0 truncate text-sm text-foreground">
							{sourceLabel}
						</span>
					</div>
					{sourceVersion && (
						<div className="mt-1 flex items-center text-xs text-muted">
							<span className="font-mono">{sourceVersion}</span>
						</div>
					)}
					{updateAvailable && latestVersion && (
						<p className="mt-1 text-xs font-medium text-accent">
							{t("updateAvailable", {
								version: latestVersion,
							})}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{canCheckUpdates && (
						<Tooltip delay={0}>
							<Button
								isIconOnly
								variant="ghost"
								size="md"
								className="min-h-[40px] min-w-[40px] text-muted hover:text-foreground"
								aria-label={
									updateAvailable
										? t("updatePlugin")
										: t("checkForUpdates")
								}
								onPress={onRefresh}
								isDisabled={isUpdating}
							>
								<ArrowPathIcon
									className={`size-4 ${isUpdating ? "animate-spin" : ""}`}
								/>
							</Button>
							<Tooltip.Content>
								{updateAvailable && latestVersion
									? t("updateToVersion", {
											version: latestVersion,
										})
									: t("checkForUpdates")}
							</Tooltip.Content>
						</Tooltip>
					)}
					{sourceUrl && (
						<Tooltip delay={0}>
							<Button
								isIconOnly
								variant="ghost"
								size="md"
								className="min-h-[40px] min-w-[40px] text-muted hover:text-foreground"
								aria-label={t("openRepository")}
								onPress={() => onOpenUrl(sourceUrl)}
							>
								<LinkIcon className="size-4" />
							</Button>
							<Tooltip.Content>
								{t("openRepository")}
							</Tooltip.Content>
						</Tooltip>
					)}
				</div>
			</div>
		</div>
	);
}

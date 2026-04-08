"use client";

import { ArrowPathIcon, TrashIcon } from "@heroicons/react/24/solid";
import { Button, Card, Switch, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { CCPluginResponse } from "../../generated/dto";

interface PluginDetailHeaderProps {
	plugin: CCPluginResponse;
	currentScope: "user" | "project" | "local";
	isToggling: boolean;
	isReinstalling: boolean;
	isUninstalling: boolean;
	onScopeChange?: (scope: "user" | "project" | "local") => void;
	onReinstall: () => void;
	onUninstall: () => void;
	onToggle: () => void;
}

export function PluginDetailHeader({
	plugin,
	currentScope,
	isToggling,
	isReinstalling,
	isUninstalling,
	onScopeChange,
	onReinstall,
	onUninstall,
	onToggle,
}: PluginDetailHeaderProps) {
	const { t } = useTranslation();

	return (
		<Card.Header className="flex flex-row items-start justify-between gap-3">
			<div className="min-w-0 flex-1">
				<h2 className="text-xl font-semibold text-foreground truncate flex items-center gap-2">
					{plugin.name}
					{plugin.scopes.length > 1 && (
						<select
							className="ml-2 rounded border border-separator bg-surface-secondary px-2 py-1 text-xs font-normal text-foreground outline-none"
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
							{plugin.scopes.map((scope) => (
								<option key={scope.scope} value={scope.scope}>
									{scope.scope}
								</option>
							))}
						</select>
					)}
				</h2>
				<p className="text-xs text-muted mt-1">{plugin.id}</p>
			</div>
			<div className="flex items-center gap-1">
				{(plugin.source === "claude-plugins-official" ||
					plugin.source.startsWith("http")) && (
					<Tooltip delay={0}>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="size-8 text-muted"
							onPress={onReinstall}
							isDisabled={isReinstalling}
							aria-label={t("reinstallPlugin")}
						>
							<ArrowPathIcon
								className={`size-4 ${isReinstalling ? "animate-spin" : ""}`}
							/>
						</Button>
						<Tooltip.Content>
							{t("reinstallPlugin")}
						</Tooltip.Content>
					</Tooltip>
				)}
				<Tooltip delay={0}>
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						className="size-8 text-muted"
						onPress={onUninstall}
						isDisabled={isUninstalling}
						aria-label={t("uninstallPlugin")}
					>
						<TrashIcon
							className={`size-4 ${isUninstalling ? "animate-spin" : ""}`}
						/>
					</Button>
					<Tooltip.Content>{t("uninstallPlugin")}</Tooltip.Content>
				</Tooltip>
				<Tooltip delay={0}>
					<Switch
						isSelected={plugin.enabled}
						isDisabled={isToggling}
						onChange={onToggle}
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
					<Tooltip.Content>
						{plugin.enabled
							? t("disablePlugin")
							: t("enablePlugin")}
					</Tooltip.Content>
				</Tooltip>
			</div>
		</Card.Header>
	);
}

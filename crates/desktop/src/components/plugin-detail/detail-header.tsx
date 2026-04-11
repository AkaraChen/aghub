"use client";

import { ArrowPathIcon, TrashIcon } from "@heroicons/react/24/solid";
import { Card, ListBox, Select, Switch, Tooltip } from "@heroui/react";
import type { Key } from "react";
import { useTranslation } from "react-i18next";
import type { CCPluginResponse } from "../../generated/dto";
import { TooltipIconButton } from "../ui/tooltip-icon-button";

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
	const handleScopeSelectionChange = (key: Key | null) => {
		if (!key) {
			return;
		}

		onScopeChange?.(key as "user" | "project" | "local");
	};

	return (
		<Card.Header className="flex flex-row items-start justify-between gap-3">
			<div className="min-w-0 flex-1">
				<h2 className="text-xl font-semibold text-foreground truncate flex items-center gap-2">
					{plugin.name}
					{plugin.scopes.length > 1 && (
						<Select
							variant="secondary"
							className="ml-2 w-32 shrink-0"
							selectedKey={currentScope}
							onSelectionChange={handleScopeSelectionChange}
						>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{plugin.scopes.map((scope) => (
										<ListBox.Item
											key={scope.scope}
											id={scope.scope}
											textValue={scope.scope}
										>
											{scope.scope}
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
					)}
				</h2>
				<p className="text-xs text-muted mt-1">{plugin.id}</p>
			</div>
			<div className="flex items-center gap-1">
				{plugin.source_info.can_reinstall && (
					<TooltipIconButton
						variant="ghost"
						size="sm"
						className="size-8 text-muted"
						onPress={onReinstall}
						isDisabled={isReinstalling}
						label={t("reinstallPlugin")}
					>
						<ArrowPathIcon
							className={`size-4 ${isReinstalling ? "animate-spin" : ""}`}
						/>
					</TooltipIconButton>
				)}
				<TooltipIconButton
					variant="ghost"
					size="sm"
					className="size-8 text-muted"
					onPress={onUninstall}
					isDisabled={isUninstalling}
					label={t("uninstallPlugin")}
				>
					<TrashIcon
						className={`size-4 ${isUninstalling ? "animate-spin" : ""}`}
					/>
				</TooltipIconButton>
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

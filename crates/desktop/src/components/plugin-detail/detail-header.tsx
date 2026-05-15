"use client";

import { ArrowPathIcon, TrashIcon } from "@heroicons/react/24/solid";
import { Button, Card, ListBox, Select, Switch, Tooltip } from "@heroui/react";
import type { Key } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import type { CCPluginResponse } from "../../generated/dto";

interface PluginDetailHeaderProps {
	plugin: CCPluginResponse;
	currentScope: "global" | "project" | "local";
	isToggling: boolean;
	isReinstalling: boolean;
	isUninstalling: boolean;
	onScopeChange?: (scope: "global" | "project" | "local") => void;
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

		onScopeChange?.(key as "global" | "project" | "local");
	};

	return (
		<Card.Header className="flex flex-row items-start justify-between gap-3">
			<div className="min-w-0 flex-1">
				<h2 className="truncate text-xl font-semibold text-foreground">
					{plugin.name}
				</h2>
				<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
					{plugin.scopes.length > 1 && (
						<Select
							variant="secondary"
							className="w-32 shrink-0"
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
				</div>
			</div>
			<div className="flex items-center gap-1">
				{plugin.source_info.can_reinstall && (
					<Tooltip delay={0}>
						<Button
							isIconOnly
							variant="ghost"
							size="md"
							className="min-h-[44px] min-w-[44px] text-muted hover:text-foreground"
							onPress={onReinstall}
							isDisabled={isReinstalling}
							aria-label={t("reinstallPlugin")}
						>
							<ArrowPathIcon
								className={cn(
									"size-4",
									isReinstalling && "animate-spin",
								)}
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
						size="md"
						className="min-h-[44px] min-w-[44px] text-muted hover:text-danger"
						onPress={onUninstall}
						isDisabled={isUninstalling}
						aria-label={t("uninstallPlugin")}
					>
						<TrashIcon
							className={cn(
								"size-4",
								isUninstalling && "animate-spin",
							)}
						/>
					</Button>
					<Tooltip.Content>{t("uninstallPlugin")}</Tooltip.Content>
				</Tooltip>
				<Tooltip delay={0}>
					<Tooltip.Trigger>
						<span className="inline-flex">
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
						</span>
					</Tooltip.Trigger>
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

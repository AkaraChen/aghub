"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PluginDetail } from "../../components/plugin-detail";
import type { PluginResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";

// Simple plugin list item for the left sidebar
function PluginListItem({
	plugin,
	isSelected,
	onClick,
}: {
	plugin: PluginResponse;
	isSelected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${
				isSelected
					? "bg-accent/5 border-l-4 border-l-accent"
					: "hover:bg-muted/50 border-l-4 border-l-transparent"
			}`}
		>
			<div className="flex items-center gap-2">
				<span
					className={`font-medium truncate ${
						isSelected ? "text-accent" : "text-foreground"
					}`}
				>
					{plugin.name}
				</span>
				<span className="text-xs text-muted-foreground">
					v{plugin.version}
				</span>
			</div>
			<p className="text-xs text-muted-foreground truncate">
				{plugin.id}
			</p>
			<div className="flex items-center gap-2 mt-1">
				{plugin.enabled ? (
					<span className="text-xs text-success">●</span>
				) : (
					<span className="text-xs text-muted">●</span>
				)}
				<span
					className={`text-xs ${
						plugin.enabled ? "text-success" : "text-muted"
					}`}
				>
					{plugin.enabled ? "Enabled" : "Disabled"}
				</span>
			</div>
		</button>
	);
}

export default function PluginsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const { data } = useSuspenseQuery({
		queryKey: ["plugins"],
		queryFn: () => api.plugins.list(),
	});

	const plugins = data?.plugins ?? [];
	const [selectedPlugin, setSelectedPlugin] = useState<PluginResponse | null>(
		plugins[0] ?? null,
	);

	return (
		<div className="flex h-full">
			{/* Plugin List Panel - Left Side */}
			<div className="flex w-80 shrink-0 flex-col border-r border-border">
				<div className="flex items-center justify-between p-4 border-b border-border">
					<div>
						<h1 className="text-lg font-semibold">
							{t("plugins")}
						</h1>
						<p className="text-xs text-muted-foreground">
							{plugins.length} {t("installed")}
						</p>
					</div>
				</div>

				{/* Plugin List */}
				<div className="flex-1 overflow-y-auto">
					{plugins.length === 0 ? (
						<div className="p-4 text-center">
							<p className="text-sm text-muted">
								{t("noPluginsInstalled")}
							</p>
						</div>
					) : (
						plugins.map((plugin) => (
							<PluginListItem
								key={plugin.id}
								plugin={plugin}
								isSelected={selectedPlugin?.id === plugin.id}
								onClick={() => setSelectedPlugin(plugin)}
							/>
						))
					)}
				</div>
			</div>

			{/* Plugin Detail Panel - Right Side */}
			<div className="flex-1 overflow-hidden">
				{selectedPlugin ? (
					<PluginDetail plugin={selectedPlugin} />
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-4">
						<div className="text-center">
							<p className="mb-2 text-sm text-muted">
								{t("selectPlugin")}
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

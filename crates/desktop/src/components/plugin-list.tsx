import {
	Card,
	Chip,
	Label,
	ScrollShadow,
	Skeleton,
	Switch,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { PluginResponse } from "../generated/dto";
import { useApi } from "../hooks/use-api";

interface PluginListProps {
	onPluginClick?: (plugin: PluginResponse) => void;
}

export function PluginList({ onPluginClick }: PluginListProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const { data, isLoading } = useQuery({
		queryKey: ["plugins"],
		queryFn: () => api.plugins.list(),
	});

	const plugins = data?.plugins ?? [];

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

	if (isLoading) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
			</div>
		);
	}

	if (plugins.length === 0) {
		return (
			<Card className="p-4">
				<p className="text-muted-foreground text-sm">
					{t("noPluginsInstalled")}
				</p>
			</Card>
		);
	}

	return (
		<ScrollShadow className="h-[calc(100vh-200px)]">
			<div className="space-y-2">
				{plugins.map((plugin) => (
					<Card
						key={plugin.id}
						className="p-4 hover:bg-muted/50 cursor-pointer transition-colors"
						onClick={() => onPluginClick?.(plugin)}
					>
						<div className="flex items-center justify-between">
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<Label className="font-medium truncate">
										{plugin.name}
									</Label>
									<span className="text-xs text-muted-foreground">
										v{plugin.version}
									</span>
								</div>
								<p className="text-xs text-muted-foreground truncate">
									{plugin.id}
								</p>
								{plugin.description && (
									<p className="text-sm text-foreground/70 mt-1 line-clamp-2">
										{plugin.description}
									</p>
								)}
								<div className="flex gap-1 mt-2">
									{plugin.has_skills && (
										<Chip size="sm" variant="secondary">
											{t("skills")}
										</Chip>
									)}
									{plugin.has_hooks && (
										<Chip size="sm" variant="secondary">
											Hooks
										</Chip>
									)}
									{plugin.has_mcp && (
										<Chip size="sm" variant="secondary">
											MCP
										</Chip>
									)}
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
					</Card>
				))}
			</div>
		</ScrollShadow>
	);
}

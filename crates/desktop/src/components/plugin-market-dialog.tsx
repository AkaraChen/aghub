"use client";

import {
	ArrowPathIcon,
	CheckIcon,
	CloudArrowDownIcon,
	StarIcon,
} from "@heroicons/react/24/solid";
import { Button, Chip, Input, Modal, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MarketPluginResponse } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { cn } from "../lib/utils";

interface PluginMarketDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

export function PluginMarketDialog({
	isOpen,
	onClose,
}: PluginMarketDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [searchQuery, setSearchQuery] = useState("");

	const {
		data: plugins = [],
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: ["plugins-market"],
		queryFn: () => api.plugins.listMarket(),
		enabled: isOpen,
	});

	const installMutation = useMutation({
		mutationFn: (pluginId: string) =>
			api.plugins.install({ plugin_id: pluginId, scope: "user" }),
		onSuccess: (_, pluginId) => {
			toast.success(t("pluginInstalled", { id: pluginId }));
			queryClient.invalidateQueries({ queryKey: ["plugins"] });
			queryClient.invalidateQueries({ queryKey: ["plugins-market"] });
		},
		onError: (err) => {
			const message =
				err instanceof Error ? err.message : t("unknownError");
			toast.danger(message);
		},
	});

	const filteredPlugins = useMemo(() => {
		if (!searchQuery) return plugins;
		const query = searchQuery.toLowerCase();
		return plugins.filter(
			(p) =>
				p.name.toLowerCase().includes(query) ||
				p.description.toLowerCase().includes(query),
		);
	}, [plugins, searchQuery]);

	const handleClose = () => {
		setSearchQuery("");
		onClose();
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
			<Modal.Container>
				<Modal.Dialog className="w-[calc(100vw-2rem)] max-w-2xl max-h-[80vh]">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("pluginMarket")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-4 space-y-4">
						<div className="flex gap-2">
							<Input
								placeholder={t("searchPlugins")}
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="flex-1"
							/>
							<Button
								isIconOnly
								variant="ghost"
								onPress={() => refetch()}
								isDisabled={isFetching}
							>
								<ArrowPathIcon
									className={cn(
										"size-4",
										isFetching && "animate-spin",
									)}
								/>
							</Button>
						</div>

						<div className="overflow-y-auto max-h-[50vh] space-y-2">
							{isLoading ? (
								<div className="flex items-center justify-center py-12">
									<ArrowPathIcon className="size-6 animate-spin text-muted" />
								</div>
							) : filteredPlugins.length === 0 ? (
								<div className="text-center py-12 text-muted">
									{searchQuery
										? t("noPluginsFound")
										: t("noPluginsAvailable")}
								</div>
							) : (
								filteredPlugins.map((plugin) => (
									<PluginMarketItem
										key={plugin.id}
										plugin={plugin}
										onInstall={() =>
											installMutation.mutate(plugin.id)
										}
										isInstalling={
											installMutation.isPending &&
											installMutation.variables ===
												plugin.id
										}
									/>
								))
							)}
						</div>
					</Modal.Body>

					<Modal.Footer>
						<Button variant="secondary" onPress={handleClose}>
							{t("close")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

interface PluginMarketItemProps {
	plugin: MarketPluginResponse;
	onInstall: () => void;
	isInstalling: boolean;
}

function PluginMarketItem({
	plugin,
	onInstall,
	isInstalling,
}: PluginMarketItemProps) {
	const { t } = useTranslation();

	return (
		<div className="flex items-start gap-3 p-3 rounded-lg border border-separator bg-surface-secondary">
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium truncate">{plugin.name}</span>
					{plugin.installed && (
						<Chip size="sm" variant="soft" color="success">
							<CheckIcon className="size-3 mr-1" />
							{t("installed")}
						</Chip>
					)}
					{plugin.enabled === false && (
						<Chip size="sm" variant="soft" color="default">
							{t("disabled")}
						</Chip>
					)}
				</div>
				<p className="text-sm text-muted line-clamp-2">
					{plugin.description}
				</p>
				<div className="flex items-center gap-3 mt-1 text-xs text-muted">
					<span className="flex items-center gap-1">
						<StarIcon className="size-3" />
						{plugin.installs}
					</span>
					<span>v{plugin.version}</span>
					<a
						href={plugin.github_url}
						target="_blank"
						rel="noopener noreferrer"
						className="text-accent hover:underline"
						onClick={(e) => e.stopPropagation()}
					>
						GitHub
					</a>
				</div>
			</div>
			<Button
				isIconOnly
				variant={plugin.installed ? "ghost" : "primary"}
				size="sm"
				onPress={onInstall}
				isDisabled={plugin.installed || isInstalling}
				isPending={isInstalling}
				aria-label={
					plugin.installed
						? t("alreadyInstalled")
						: t("installPlugin")
				}
			>
				{!isInstalling && <CloudArrowDownIcon className="size-4" />}
			</Button>
		</div>
	);
}

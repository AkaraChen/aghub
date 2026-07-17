import {
	EllipsisVerticalIcon,
	PlayIcon,
	StopIcon,
} from "@heroicons/react/24/solid";
import { Button, Chip, Dropdown, Spinner, Tabs, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type {
	GatewayInstanceDto,
	GatewayInstanceStatus,
} from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { useGatewayLaunch } from "../../hooks/use-gateway-launch";
import { cn } from "../../lib/utils";
import {
	gatewayVersionQueryOptions,
	startGatewayInstanceMutationOptions,
	stopGatewayInstanceMutationOptions,
} from "../../requests/gateway";
import { GatewayAccountsPanel } from "./accounts-panel";
import { GatewayApiKeysPanel } from "./api-keys-panel";
import { DeleteGatewayInstanceDialog } from "./delete-instance-dialog";
import {
	GATEWAY_STATUS_DISPLAY,
	displayGatewayHost,
	gatewayLaunchLabel,
} from "./gateway-helpers";
import { GatewayNotRunningNotice } from "./gateway-status";
import { GatewayUpstreamKeysPanel } from "./upstream-keys-panel";
import { GatewayUsagePanel } from "./usage-panel";

const STATUS_CHIP_COLOR: Record<
	GatewayInstanceStatus,
	"default" | "success" | "warning"
> = {
	not_provisioned: "default",
	stopped: "default",
	starting: "default",
	running: "success",
	unhealthy: "warning",
};

interface GatewayDetailPanelProps {
	instance: GatewayInstanceDto;
	instances: GatewayInstanceDto[];
}

export function GatewayDetailPanel({
	instance,
	instances,
}: GatewayDetailPanelProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [, setLocation] = useLocation();
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const launch = useGatewayLaunch();

	const statusDisplay = GATEWAY_STATUS_DISPLAY[instance.status];
	const isManaged = instance.kind === "managed";
	const needsProvision = isManaged && instance.status === "not_provisioned";
	const canStart = isManaged && instance.status === "stopped";
	const canStop =
		isManaged &&
		(instance.status === "running" ||
			instance.status === "starting" ||
			instance.status === "unhealthy");
	const isRunning = instance.status === "running";

	const { data: version } = useQuery(
		gatewayVersionQueryOptions({ api, instanceId: instance.id }),
	);

	const startMutation = useMutation({
		...startGatewayInstanceMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayInstanceStarted"));
			},
		}),
		onError: (error) => {
			console.error("Failed to start gateway instance:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayStartFailed"),
			);
		},
	});

	const stopMutation = useMutation({
		...stopGatewayInstanceMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayInstanceStopped"));
			},
		}),
		onError: (error) => {
			console.error("Failed to stop gateway instance:", error);
			toast.danger(
				error instanceof Error ? error.message : t("gatewayStopFailed"),
			);
		},
	});

	const installedVersion = instance.version ?? version?.installed ?? null;
	const hasNewerVersion =
		version?.latest != null && version.latest !== version.installed;

	return (
		<div className="flex h-full flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
				<div className="flex items-center gap-3">
					<h2 className="min-w-0 truncate text-xl font-semibold text-foreground">
						{instance.name}
					</h2>
					<Chip
						size="sm"
						variant="soft"
						color={STATUS_CHIP_COLOR[instance.status]}
					>
						<span
							className={cn(
								"size-1.5 rounded-full",
								statusDisplay.dotClass,
							)}
							aria-hidden
						/>
						{t(statusDisplay.labelKey)}
					</Chip>
					{installedVersion && (
						<span className="shrink-0 text-xs text-muted tabular-nums">
							v{installedVersion}
						</span>
					)}
					{hasNewerVersion && version?.latest && (
						<Chip size="sm" variant="soft" color="accent">
							{t("gatewayNewVersion", {
								version: version.latest,
							})}
						</Chip>
					)}
					<div className="ml-auto flex shrink-0 items-center gap-2">
						{needsProvision && (
							<Button
								size="sm"
								isPending={launch.isPending}
								onPress={() => launch.launch({ start: true })}
							>
								{({ isPending }) => (
									<>
										{isPending && (
											<Spinner
												color="current"
												size="sm"
											/>
										)}
										{isPending
											? gatewayLaunchLabel(
													t,
													launch.stage,
													launch.progress,
												)
											: t("gatewayInstallAndStart")}
									</>
								)}
							</Button>
						)}
						{canStart && (
							<Button
								size="sm"
								isPending={startMutation.isPending}
								onPress={() =>
									startMutation.mutate(instance.id)
								}
							>
								<PlayIcon className="size-4" />
								{t("gatewayStart")}
							</Button>
						)}
						{canStop && (
							<Button
								variant="secondary"
								size="sm"
								isPending={stopMutation.isPending}
								onPress={() => stopMutation.mutate(instance.id)}
							>
								<StopIcon className="size-4" />
								{t("gatewayStop")}
							</Button>
						)}
						<Dropdown>
							<Button
								isIconOnly
								variant="ghost"
								size="sm"
								className="text-muted"
								aria-label={t("actions")}
							>
								<EllipsisVerticalIcon className="size-4" />
							</Button>
							<Dropdown.Popover placement="bottom end">
								<Dropdown.Menu
									onAction={(key) => {
										if (key === "settings") {
											setLocation(
												"/settings?tab=gateway",
											);
										} else if (key === "delete") {
											setIsDeleteOpen(true);
										}
									}}
								>
									<Dropdown.Item
										id="settings"
										textValue={t("gatewayOpenSettings")}
									>
										{t("gatewayOpenSettings")}
									</Dropdown.Item>
									<Dropdown.Item
										id="delete"
										variant="danger"
										textValue={t("gatewayDeleteInstance")}
									>
										{t("gatewayDeleteInstance")}
									</Dropdown.Item>
								</Dropdown.Menu>
							</Dropdown.Popover>
						</Dropdown>
					</div>
				</div>

				<div className="mt-1 text-xs text-muted">
					<span className="font-mono">
						{displayGatewayHost(instance.base_url)}
					</span>
				</div>

				<div className="mt-4">
					{isRunning ? (
						<Tabs defaultSelectedKey="accounts">
							<Tabs.ListContainer>
								<Tabs.List
									aria-label={t("gatewayTabAccounts")}
									className="inline-flex w-auto"
								>
									<Tabs.Tab id="accounts">
										{t("gatewayTabAccounts")}
										<Tabs.Indicator />
									</Tabs.Tab>
									<Tabs.Tab id="upstream">
										{t("gatewayTabUpstream")}
										<Tabs.Indicator />
									</Tabs.Tab>
									<Tabs.Tab id="keys">
										{t("gatewayTabKeys")}
										<Tabs.Indicator />
									</Tabs.Tab>
									<Tabs.Tab id="usage">
										{t("gatewayTabUsage")}
										<Tabs.Indicator />
									</Tabs.Tab>
								</Tabs.List>
							</Tabs.ListContainer>
							<Tabs.Panel id="accounts">
								<GatewayAccountsPanel
									instance={instance}
									instances={instances}
								/>
							</Tabs.Panel>
							<Tabs.Panel id="upstream">
								<GatewayUpstreamKeysPanel
									instanceId={instance.id}
								/>
							</Tabs.Panel>
							<Tabs.Panel id="keys">
								<GatewayApiKeysPanel instanceId={instance.id} />
							</Tabs.Panel>
							<Tabs.Panel id="usage">
								<GatewayUsagePanel instanceId={instance.id} />
							</Tabs.Panel>
						</Tabs>
					) : (
						<GatewayNotRunningNotice />
					)}
				</div>
			</div>

			<DeleteGatewayInstanceDialog
				instance={instance}
				isOpen={isDeleteOpen}
				onClose={() => setIsDeleteOpen(false)}
			/>
		</div>
	);
}

import { PlayIcon, StopIcon } from "@heroicons/react/24/solid";
import { Button, Chip, Spinner, toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { GatewayInstanceDto } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { useGatewayLaunch } from "../../hooks/use-gateway-launch";
import {
	startGatewayInstanceMutationOptions,
	stopGatewayInstanceMutationOptions,
} from "../../requests/gateway";
import { gatewayLaunchLabel } from "./gateway-helpers";
import { GatewayStatusIndicator } from "./gateway-status";

interface GatewayInstanceRowProps {
	instance: GatewayInstanceDto;
	onOpenAccounts: () => void;
}

export function GatewayInstanceRow({
	instance,
	onOpenAccounts,
}: GatewayInstanceRowProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [, setLocation] = useLocation();
	const launch = useGatewayLaunch();

	const isManaged = instance.kind === "managed";
	const needsProvision = isManaged && instance.status === "not_provisioned";
	const canStart = isManaged && instance.status === "stopped";
	const canStop =
		isManaged &&
		(instance.status === "running" ||
			instance.status === "starting" ||
			instance.status === "unhealthy");

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

	return (
		<div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
			<GatewayStatusIndicator status={instance.status} />
			<span className="min-w-0 truncate text-sm font-medium text-foreground">
				{instance.name}
			</span>
			{!isManaged && (
				<Chip size="sm" variant="soft">
					{t("gatewayKindExternal")}
				</Chip>
			)}
			{instance.version && (
				<span className="shrink-0 font-mono text-xs text-muted">
					{instance.version}
				</span>
			)}
			<div className="ml-auto flex shrink-0 items-center gap-1.5">
				{needsProvision && (
					<Button
						size="sm"
						isPending={launch.isPending}
						onPress={() => launch.launch({ start: true })}
					>
						{({ isPending }) => (
							<>
								{isPending && (
									<Spinner color="current" size="sm" />
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
						variant="secondary"
						size="sm"
						isPending={startMutation.isPending}
						onPress={() => startMutation.mutate(instance.id)}
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
				<Button
					variant="secondary"
					size="sm"
					isDisabled={instance.status !== "running"}
					onPress={onOpenAccounts}
				>
					{t("gatewayAccountsButton")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="text-muted"
					onPress={() => setLocation("/settings?tab=gateway")}
				>
					{t("settings")}
				</Button>
			</div>
		</div>
	);
}

import {
	CloudArrowDownIcon,
	PencilIcon,
	PlayIcon,
	StopIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Chip, ProgressBar, Switch, toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import type { GatewayInstanceDto } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { cn } from "../../lib/utils";
import {
	startGatewayInstanceMutationOptions,
	stopGatewayInstanceMutationOptions,
	updateGatewayInstanceMutationOptions,
} from "../../requests/gateway";
import { GATEWAY_STATUS_DISPLAY } from "./gateway-helpers";
import { useGatewayProvision } from "./hooks/use-gateway-provision";
import {
	DeleteGatewayInstanceDialog,
	RenameGatewayInstanceDialog,
} from "./instance-dialogs";

function ProvisionZone() {
	const { t } = useTranslation();
	const { status, isDownloading, provision } = useGatewayProvision({
		enabled: true,
	});

	if (isDownloading) {
		const progress =
			status?.phase === "downloading" ? status.progress : null;
		return (
			<ProgressBar
				value={progress ?? undefined}
				isIndeterminate={progress == null}
				aria-label={t("gatewayProvisionDownloading")}
				className="w-full"
			>
				<div className="flex items-center justify-between gap-2 text-xs text-muted">
					<span>
						{status?.phase === "extracting"
							? t("gatewayProvisionExtracting")
							: t("gatewayProvisionDownloading")}
					</span>
					{progress != null && <ProgressBar.Output />}
				</div>
				<ProgressBar.Track>
					<ProgressBar.Fill />
				</ProgressBar.Track>
			</ProgressBar>
		);
	}

	return (
		<div>
			<Button
				variant="secondary"
				size="sm"
				isDisabled={!status}
				onPress={provision}
			>
				<CloudArrowDownIcon className="size-4" />
				{status
					? t("gatewayProvisionDownload", { version: status.version })
					: t("gatewayProvisionDownloading")}
			</Button>
		</div>
	);
}

interface GatewayInstanceCardProps {
	instance: GatewayInstanceDto;
}

export function GatewayInstanceCard({ instance }: GatewayInstanceCardProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isRenameOpen, setIsRenameOpen] = useState(false);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);

	const statusDisplay = GATEWAY_STATUS_DISPLAY[instance.status];
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

	const autoStartMutation = useMutation({
		...updateGatewayInstanceMutationOptions({ api, queryClient }),
		onError: (error) => {
			console.error("Failed to update gateway auto-start:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayUpdateFailed"),
			);
		},
	});

	const handleAutoStartChange = (autoStart: boolean) => {
		autoStartMutation.mutate({
			id: instance.id,
			body: {
				name: null,
				auto_start: autoStart,
				base_url: null,
				management_key: null,
			},
		});
	};

	return (
		<Card variant="secondary">
			<Card.Content className="flex flex-col gap-3">
				<Link
					href={`/gateway/${instance.id}`}
					className="group flex min-w-0 flex-col gap-1"
				>
					<div className="flex min-w-0 items-center gap-2">
						<span className="truncate text-base font-medium text-foreground group-hover:underline">
							{instance.name}
						</span>
						<Chip size="sm" variant="soft">
							{isManaged
								? t("gatewayKindManaged")
								: t("gatewayKindExternal")}
						</Chip>
						<span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted">
							<span
								className={cn(
									"size-2 rounded-full",
									statusDisplay.dotClass,
								)}
								aria-hidden
							/>
							{t(statusDisplay.labelKey)}
						</span>
					</div>
					<span className="truncate font-mono text-xs text-muted">
						{instance.base_url}
					</span>
				</Link>

				{needsProvision && <ProvisionZone />}

				<div className="flex items-center gap-3">
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
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted">
							{t("gatewayAutoStart")}
						</span>
						<Switch
							size="sm"
							isSelected={instance.auto_start}
							isDisabled={autoStartMutation.isPending}
							onChange={handleAutoStartChange}
							aria-label={t("gatewayAutoStart")}
						>
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
						</Switch>
					</div>
					<div className="ml-auto flex items-center gap-1">
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="text-muted"
							aria-label={t("gatewayRenameInstance")}
							onPress={() => setIsRenameOpen(true)}
						>
							<PencilIcon className="size-4" />
						</Button>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="text-muted"
							aria-label={t("gatewayDeleteInstance")}
							onPress={() => setIsDeleteOpen(true)}
						>
							<TrashIcon className="size-4" />
						</Button>
					</div>
				</div>
			</Card.Content>

			<RenameGatewayInstanceDialog
				key={`${instance.id}-${instance.name}`}
				instance={instance}
				isOpen={isRenameOpen}
				onClose={() => setIsRenameOpen(false)}
			/>
			<DeleteGatewayInstanceDialog
				instance={instance}
				isOpen={isDeleteOpen}
				onClose={() => setIsDeleteOpen(false)}
			/>
		</Card>
	);
}

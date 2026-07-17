import {
	PlayIcon,
	PlusIcon,
	StopIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	Button,
	Card,
	Disclosure,
	Input,
	Spinner,
	Switch,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GatewayAccountsDrawer } from "../../components/gateway/accounts-drawer";
import { GatewayConfigPanel } from "../../components/gateway/config-panel";
import { CreateExternalGatewayDialog } from "../../components/gateway/create-external-dialog";
import { DeleteGatewayInstanceDialog } from "../../components/gateway/delete-instance-dialog";
import { GatewayExcludedModelsPanel } from "../../components/gateway/excluded-models-panel";
import { gatewayLaunchLabel } from "../../components/gateway/gateway-helpers";
import {
	GatewayNotRunningNotice,
	GatewayStatusIndicator,
} from "../../components/gateway/gateway-status";
import { GatewaySettingsPanel } from "../../components/gateway/settings-panel";
import type { GatewayInstanceDto } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { useGatewayLaunch } from "../../hooks/use-gateway-launch";
import { getGatewayMirror, setGatewayMirror } from "../../lib/store";
import {
	gatewayInstanceListQueryOptions,
	gatewayVersionQueryOptions,
	startGatewayInstanceMutationOptions,
	stopGatewayInstanceMutationOptions,
	updateGatewayInstanceMutationOptions,
} from "../../requests/gateway";

const GATEWAY_MIRROR_QUERY_KEY = ["gateway-mirror"] as const;

function InstallStatusCard({
	managed,
}: {
	managed: GatewayInstanceDto | null;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const launch = useGatewayLaunch();

	const { data: version } = useQuery(
		gatewayVersionQueryOptions({
			api,
			instanceId: managed?.id ?? "",
			enabled: Boolean(managed),
		}),
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

	const autoStartMutation = useMutation({
		...updateGatewayInstanceMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("gatewayInstanceUpdated"));
			},
		}),
		onError: (error) => {
			console.error("Failed to update gateway auto-start:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayUpdateFailed"),
			);
		},
	});

	const needsProvision = !managed || managed.status === "not_provisioned";
	const canStart = managed?.status === "stopped";
	const canStop =
		managed !== null &&
		(managed.status === "running" ||
			managed.status === "starting" ||
			managed.status === "unhealthy");

	return (
		<Card variant="secondary">
			<Card.Header>
				<div>
					<Card.Title>{t("gatewayInstallStatusTitle")}</Card.Title>
					<Card.Description>{t("gatewayValueProp")}</Card.Description>
				</div>
			</Card.Header>
			<Card.Content className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-3">
					{managed ? (
						<GatewayStatusIndicator status={managed.status} />
					) : (
						<span className="text-xs text-muted">
							{t("gatewayNotInstalled")}
						</span>
					)}
					{managed?.port != null && (
						<span className="font-mono text-xs text-muted">
							{t("gatewayPort")}: {managed.port}
						</span>
					)}
					{version && (
						<span className="text-xs text-muted">
							{t("gatewayVersionInstalled")}:{" "}
							{version.installed ?? "—"} ·{" "}
							{t("gatewayVersionPinned")}: {version.pinned}
							{version.latest
								? ` · ${t("gatewayVersionLatest")}: ${version.latest}`
								: ""}
						</span>
					)}
					<div className="ml-auto flex shrink-0 items-center gap-1.5">
						{needsProvision && (
							<Button
								size="sm"
								isPending={launch.isPending}
								onPress={() => launch.launch({ start: false })}
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
											: t("gatewayInstall")}
									</>
								)}
							</Button>
						)}
						{canStart && (
							<Button
								variant="secondary"
								size="sm"
								isPending={startMutation.isPending}
								onPress={() => {
									if (!managed) return;
									startMutation.mutate(managed.id);
								}}
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
								onPress={() => {
									if (!managed) return;
									stopMutation.mutate(managed.id);
								}}
							>
								<StopIcon className="size-4" />
								{t("gatewayStop")}
							</Button>
						)}
					</div>
				</div>
				{version && (
					<div className="flex flex-col gap-0.5 text-xs text-muted">
						<span>
							{version.bin_source === "env"
								? t("gatewayBinSourceEnv")
								: version.bin_source === "downloaded"
									? t("gatewayBinSourceDownloaded", {
											version:
												version.installed ??
												version.pinned,
										})
									: t("gatewayNotInstalled")}
						</span>
						{version.system_bin && (
							<span>
								{t("gatewaySystemBinHint", {
									path: version.system_bin,
								})}
							</span>
						)}
					</div>
				)}
				{managed && (
					<div className="flex items-center justify-between gap-4">
						<span className="text-sm text-foreground">
							{t("gatewayAutoStart")}
						</span>
						<Switch
							size="sm"
							isSelected={managed.auto_start}
							isDisabled={autoStartMutation.isPending}
							onChange={(autoStart) =>
								autoStartMutation.mutate({
									id: managed.id,
									body: {
										name: null,
										auto_start: autoStart,
										base_url: null,
										management_key: null,
									},
								})
							}
							aria-label={t("gatewayAutoStart")}
						>
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
						</Switch>
					</div>
				)}
				<MirrorField />
			</Card.Content>
		</Card>
	);
}

/** "Download source" row inside the install & status card. */
function MirrorField() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<string | null>(null);

	const { data: mirror = null } = useQuery({
		queryKey: GATEWAY_MIRROR_QUERY_KEY,
		queryFn: getGatewayMirror,
	});
	const value = draft ?? mirror ?? "";
	const isDirty = draft !== null && draft.trim() !== (mirror ?? "");

	const saveMutation = useMutation({
		mutationFn: async (next: string) => {
			await setGatewayMirror(next.trim() || null);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: GATEWAY_MIRROR_QUERY_KEY,
			});
			setDraft(null);
			toast.success(t("gatewayMirrorSaved"));
		},
		onError: (error) => {
			console.error("Failed to save gateway mirror:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayUpdateFailed"),
			);
		},
	});

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-2">
				<span className="shrink-0 text-sm text-foreground">
					{t("gatewayMirrorTitle")}
				</span>
				<Input
					value={value}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="https://mirror.example.com"
					aria-label={t("gatewayMirrorTitle")}
					variant="secondary"
					className="min-w-0 flex-1 font-mono text-sm"
				/>
				<Button
					size="sm"
					className="shrink-0"
					isDisabled={!isDirty}
					isPending={saveMutation.isPending}
					onPress={() => saveMutation.mutate(value)}
				>
					{t("save")}
				</Button>
			</div>
			<p className="text-xs text-muted">
				{t("gatewayMirrorDescription")}
			</p>
		</div>
	);
}

function RemoteInstancesCard({
	externals,
	onOpenAccounts,
	onDelete,
	onConnect,
}: {
	externals: GatewayInstanceDto[];
	onOpenAccounts: (instance: GatewayInstanceDto) => void;
	onDelete: (instance: GatewayInstanceDto) => void;
	onConnect: () => void;
}) {
	const { t } = useTranslation();

	return (
		<Card variant="secondary">
			<Card.Header className="flex flex-row items-start justify-between gap-3">
				<div>
					<Card.Title>{t("gatewayRemoteInstances")}</Card.Title>
					<Card.Description>
						{t("gatewayAddAccountExternalHint")}
					</Card.Description>
				</div>
				<Button
					variant="secondary"
					size="sm"
					className="shrink-0"
					onPress={onConnect}
				>
					<PlusIcon className="size-4" />
					{t("gatewayAddExternal")}
				</Button>
			</Card.Header>
			<Card.Content>
				{externals.length === 0 ? (
					<p className="text-sm text-muted">
						{t("gatewayNoRemoteInstances")}
					</p>
				) : (
					<div className="flex flex-col gap-1.5">
						{externals.map((instance) => (
							<div
								key={instance.id}
								className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-1.5"
							>
								<GatewayStatusIndicator
									status={instance.status}
								/>
								<span className="min-w-0 truncate text-sm font-medium text-foreground">
									{instance.name}
								</span>
								<span className="min-w-0 truncate font-mono text-xs text-muted">
									{instance.base_url}
								</span>
								<div className="ml-auto flex shrink-0 items-center gap-1.5">
									<Button
										variant="secondary"
										size="sm"
										isDisabled={
											instance.status !== "running"
										}
										onPress={() => onOpenAccounts(instance)}
									>
										{t("gatewayAccountsButton")}
									</Button>
									<Button
										isIconOnly
										variant="ghost"
										size="sm"
										className="text-muted"
										aria-label={t("gatewayDeleteInstance")}
										onPress={() => onDelete(instance)}
									>
										<TrashIcon className="size-4" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</Card.Content>
		</Card>
	);
}

export default function GatewayPanel() {
	const { t } = useTranslation();
	const api = useApi();
	const [isConnectOpen, setIsConnectOpen] = useState(false);
	const [drawerInstanceId, setDrawerInstanceId] = useState<string | null>(
		null,
	);
	const [deleteTarget, setDeleteTarget] = useState<GatewayInstanceDto | null>(
		null,
	);

	const { data: instances = [], isLoading } = useQuery(
		gatewayInstanceListQueryOptions({ api }),
	);

	const managed =
		instances.find((instance) => instance.kind === "managed") ?? null;
	const externals = instances.filter(
		(instance) => instance.kind === "external",
	);
	const drawerInstance =
		instances.find((item) => item.id === drawerInstanceId) ?? null;

	if (isLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<InstallStatusCard managed={managed} />

			{managed && (
				<Card variant="secondary">
					<Card.Header>
						<div>
							<Card.Title>
								{t("gatewayCliproxySettings")}
							</Card.Title>
						</div>
					</Card.Header>
					<Card.Content>
						{managed.status === "running" ? (
							<GatewaySettingsPanel instanceId={managed.id} />
						) : (
							<GatewayNotRunningNotice />
						)}
					</Card.Content>
				</Card>
			)}

			{managed && managed.status === "running" && (
				<Card variant="secondary">
					<Card.Header>
						<div>
							<Card.Title>
								{t("gatewayExcludedModelsTitle")}
							</Card.Title>
							<Card.Description>
								{t("gatewayExcludedModelsDescription")}
							</Card.Description>
						</div>
					</Card.Header>
					<Card.Content>
						<GatewayExcludedModelsPanel instanceId={managed.id} />
					</Card.Content>
				</Card>
			)}

			{managed && managed.status === "running" && (
				<Card variant="secondary">
					<Card.Content>
						<Disclosure>
							<Disclosure.Heading>
								<Disclosure.Trigger>
									{t("gatewayTabConfig")}
									<Disclosure.Indicator />
								</Disclosure.Trigger>
							</Disclosure.Heading>
							<Disclosure.Content>
								<Disclosure.Body>
									<GatewayConfigPanel
										instanceId={managed.id}
									/>
								</Disclosure.Body>
							</Disclosure.Content>
						</Disclosure>
					</Card.Content>
				</Card>
			)}

			<RemoteInstancesCard
				externals={externals}
				onOpenAccounts={(instance) => setDrawerInstanceId(instance.id)}
				onDelete={setDeleteTarget}
				onConnect={() => setIsConnectOpen(true)}
			/>

			<CreateExternalGatewayDialog
				isOpen={isConnectOpen}
				onClose={() => setIsConnectOpen(false)}
			/>
			<GatewayAccountsDrawer
				instance={drawerInstance}
				instances={instances}
				onClose={() => setDrawerInstanceId(null)}
			/>
			{deleteTarget && (
				<DeleteGatewayInstanceDialog
					instance={deleteTarget}
					isOpen
					onClose={() => setDeleteTarget(null)}
				/>
			)}
		</div>
	);
}

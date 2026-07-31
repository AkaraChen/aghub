import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { Button, toast, Tooltip } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import { shortCcusageVersion } from "../../lib/usage-format";
import { cn } from "../../lib/utils";
import {
	installUsageRuntimeMutationOptions,
	refreshUsageRuntimeMutationOptions,
	setUsageRuntimeMutationOptions,
	updateUsageRuntimeMutationOptions,
	usageRuntimeQueryOptions,
} from "../../requests/usage";
import { RuntimeSourceControls } from "./usage-runtime-source";

export function UsageRuntimeSection() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const runtimeQuery = useQuery(usageRuntimeQueryOptions({ api }));
	const selectMutation = useMutation(
		setUsageRuntimeMutationOptions({ api, queryClient }),
	);
	const installMutation = useMutation(
		installUsageRuntimeMutationOptions({ api, queryClient }),
	);
	const updateMutation = useMutation(
		updateUsageRuntimeMutationOptions({ api, queryClient }),
	);
	const refreshMutation = useMutation(
		refreshUsageRuntimeMutationOptions({ api, queryClient }),
	);
	const runtime = runtimeQuery.data;
	const canInstall =
		runtime?.candidates.some((candidate) => candidate.can_install) ?? false;
	const canUpdate = runtime?.active?.can_update === true;
	const isOperating =
		selectMutation.isPending ||
		installMutation.isPending ||
		updateMutation.isPending ||
		refreshMutation.isPending;
	const queryError =
		runtimeQuery.error instanceof Error
			? runtimeQuery.error.message
			: undefined;
	const statusError = runtime?.error ?? queryError;
	const isChecking = runtimeQuery.isPending || refreshMutation.isPending;
	const isStatusPending =
		isChecking ||
		selectMutation.isPending ||
		installMutation.isPending ||
		updateMutation.isPending;
	let statusKey = "usageRuntimeStatusUnavailable";
	if (selectMutation.isPending) {
		statusKey = "usageRuntimeStatusSwitching";
	} else if (installMutation.isPending) {
		statusKey = "usageRuntimeStatusInstalling";
	} else if (updateMutation.isPending) {
		statusKey = "usageRuntimeStatusUpdating";
	} else if (isChecking) {
		statusKey = "usageRuntimeStatusChecking";
	} else if (statusError && runtime?.active) {
		statusKey = "usageRuntimeStatusCheckFailed";
	} else if (runtime?.update_available) {
		statusKey = "usageRuntimeStatusUpdateAvailable";
	} else if (runtime?.active && runtime.latest_version) {
		statusKey = "usageRuntimeStatusUpToDate";
	} else if (runtime?.active) {
		statusKey = "usageRuntimeStatusReady";
	}
	const latestVersion = runtime?.latest_version
		? shortCcusageVersion(runtime.latest_version)
		: null;
	const activeVersion = runtime?.active?.version
		? shortCcusageVersion(runtime.active.version)
		: null;
	const showUpdate = runtime?.update_available && canUpdate;
	const showManagedInstall =
		runtime?.update_available &&
		runtime.active &&
		runtime.active.source !== "environment" &&
		!canUpdate &&
		canInstall;
	const showInitialInstall = runtime && !runtime.active && canInstall;
	const reportError = (error: Error) => toast.danger(error.message);
	const actions = (
		<>
			{showUpdate && (
				<Button
					size="sm"
					variant="secondary"
					isPending={updateMutation.isPending}
					isDisabled={isOperating && !updateMutation.isPending}
					onPress={() =>
						updateMutation.mutate(undefined, {
							onSuccess: () =>
								toast.success(t("usageRuntimeUpdated")),
							onError: reportError,
						})
					}
				>
					{latestVersion
						? t("usageRuntimeUpdateTo", {
								version: latestVersion,
							})
						: t("usageRuntimeUpdate")}
				</Button>
			)}
			{(showManagedInstall || showInitialInstall) && (
				<Button
					size="sm"
					variant="secondary"
					isPending={installMutation.isPending}
					isDisabled={isOperating && !installMutation.isPending}
					onPress={() =>
						installMutation.mutate(
							{ source: "auto" },
							{
								onSuccess: () =>
									toast.success(t("usageRuntimeInstalled")),
								onError: reportError,
							},
						)
					}
				>
					{showManagedInstall && latestVersion
						? t("usageRuntimeInstallVersion", {
								version: latestVersion,
							})
						: t("usageRuntimeInstall")}
				</Button>
			)}
		</>
	);

	return (
		<section
			className="grid grid-cols-1 items-center gap-x-2 gap-y-2 px-1 pb-5 sm:grid-cols-[minmax(0,1fr)_auto]"
			aria-labelledby="usage-runtime-heading"
		>
			<div
				className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
				data-testid="usage-runtime-summary"
			>
				<h3
					id="usage-runtime-heading"
					className="text-sm font-semibold text-(--foreground)"
				>
					ccusage
				</h3>
				{activeVersion && (
					<span
						className="text-xs tabular-nums text-muted"
						data-testid="usage-runtime-version"
					>
						{activeVersion}
					</span>
				)}
				<span
					aria-hidden
					className={cn(
						"size-2 rounded-full",
						isStatusPending
							? "bg-muted"
							: statusError
								? "bg-danger"
								: runtime?.active
									? "bg-success"
									: "bg-warning",
					)}
				/>
				<span
					role="status"
					aria-live="polite"
					className={cn(
						"text-xs",
						isStatusPending
							? "text-muted"
							: statusError || !runtime?.active
								? "text-danger"
								: runtime.update_available
									? "text-accent"
									: "text-muted",
					)}
				>
					{t(statusKey)}
				</span>
				<Tooltip delay={400}>
					<Button
						isIconOnly
						isPending={refreshMutation.isPending}
						isDisabled={isOperating && !refreshMutation.isPending}
						size="sm"
						variant="ghost"
						onPress={() =>
							refreshMutation.mutate(undefined, {
								onError: reportError,
							})
						}
						aria-label={t("usageStatusRecheck")}
						className="text-muted"
					>
						{({ isPending }) => (
							<ArrowPathIcon
								className={cn(
									"size-3.5",
									isPending &&
										"animate-spin motion-reduce:animate-none",
								)}
							/>
						)}
					</Button>
					<Tooltip.Content>{t("usageStatusRecheck")}</Tooltip.Content>
				</Tooltip>
			</div>

			{runtime ? (
				<RuntimeSourceControls
					key={`${runtime.preference}:${runtime.active?.source ?? "none"}`}
					runtime={runtime}
					isPending={isOperating}
					actions={actions}
					onSelect={(source, path) =>
						selectMutation.mutate(
							{ source, path },
							{ onError: reportError },
						)
					}
					onInstall={(source) =>
						installMutation.mutate(
							{ source },
							{
								onSuccess: () =>
									toast.success(t("usageRuntimeInstalled")),
								onError: reportError,
							},
						)
					}
				/>
			) : (
				<div className="flex flex-wrap items-center gap-2 sm:justify-end">
					{actions}
				</div>
			)}
			{statusError && !isStatusPending && (
				<p className="col-span-full break-words text-xs text-danger">
					{statusError}
				</p>
			)}
		</section>
	);
}

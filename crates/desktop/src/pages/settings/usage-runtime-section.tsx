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

const MANAGED_SOURCES = new Set(["bun", "npm", "download"]);

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
	const activeVersion = runtime?.active
		? shortCcusageVersion(runtime.active.version)
		: null;
	const latestVersion = runtime?.latest_version
		? shortCcusageVersion(runtime.latest_version)
		: null;
	const activeIsManaged = runtime?.active
		? MANAGED_SOURCES.has(runtime.active.source)
		: false;

	const showUpdate = runtime?.update_available && canUpdate;
	const showManagedInstall =
		runtime?.update_available &&
		runtime.active &&
		runtime.active.source !== "environment" &&
		!canUpdate &&
		canInstall;
	const showInitialInstall = runtime && !runtime.active && canInstall;
	const reportError = (error: Error) => toast.danger(error.message);

	return (
		<section
			className="space-y-4 px-1 pb-5"
			aria-labelledby="usage-runtime-heading"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 space-y-0.5">
					<div className="flex items-center gap-2">
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
						<h3
							id="usage-runtime-heading"
							className="text-sm font-semibold text-(--foreground)"
						>
							ccusage
						</h3>
					</div>
					<div className="ml-4 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
						<span
							role="status"
							aria-live="polite"
							className={cn(
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
						{activeVersion && (
							<span className="font-medium tabular-nums text-(--foreground)">
								{activeVersion}
							</span>
						)}
						{runtime?.update_available && latestVersion && (
							<span className="tabular-nums text-accent">
								{t("usageRuntimeLatestVersion", {
									version: latestVersion,
								})}
							</span>
						)}
					</div>
					{statusError && !isStatusPending && (
						<p className="ml-4 mt-1 break-words text-xs text-danger">
							{statusError}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{showUpdate && (
						<Button
							size="sm"
							variant="secondary"
							isPending={updateMutation.isPending}
							isDisabled={
								isOperating && !updateMutation.isPending
							}
							onPress={() =>
								updateMutation.mutate(undefined, {
									onSuccess: () =>
										toast.success(t("usageRuntimeUpdated")),
									onError: reportError,
								})
							}
						>
							{latestVersion
								? t(
										activeIsManaged
											? "usageRuntimeUpdateTo"
											: "usageRuntimeInstallVersion",
										{ version: latestVersion },
									)
								: t("usageRuntimeUpdate")}
						</Button>
					)}
					{(showManagedInstall || showInitialInstall) && (
						<Button
							size="sm"
							variant="secondary"
							isPending={installMutation.isPending}
							isDisabled={
								isOperating && !installMutation.isPending
							}
							onPress={() =>
								installMutation.mutate(
									{ source: "auto" },
									{
										onSuccess: () =>
											toast.success(
												t("usageRuntimeInstalled"),
											),
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
					<Tooltip delay={400}>
						<Button
							isIconOnly
							isPending={refreshMutation.isPending}
							isDisabled={
								isOperating && !refreshMutation.isPending
							}
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
						<Tooltip.Content>
							{t("usageStatusRecheck")}
						</Tooltip.Content>
					</Tooltip>
				</div>
			</div>

			{runtime && (
				<RuntimeSourceControls
					key={`${runtime.preference}:${runtime.active?.source ?? "none"}`}
					runtime={runtime}
					isPending={isOperating}
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
			)}
		</section>
	);
}

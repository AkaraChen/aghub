import { Avatar, Button, Card, Switch, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getName, getVersion } from "@tauri-apps/api/app";
import {
	disable as disableAutostart,
	enable as enableAutostart,
	isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";
import { saveAnalyticsPreference } from "../../lib/analytics-preference";
import { dispatchOnboardingCommand } from "../../lib/onboarding";
import { isWindows } from "../../lib/platform";
import { getAnalyticsConsent } from "../../lib/store";
import {
	autoCheckUpdatesQueryOptions,
	checkForUpdate,
	installUpdate,
	setAutoCheckUpdatesMutationOptions,
	setUpdateChannelMutationOptions,
	updateChannelQueryOptions,
} from "../../requests/updates";

export default function ApplicationPanel() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const isWindowsOS = isWindows();

	const { data: appInfo } = useQuery({
		queryKey: ["app-info"],
		queryFn: async () => {
			const name = await getName();
			const version = await getVersion();
			return { name, version };
		},
	});

	const { data: analyticsConsent } = useQuery({
		queryKey: ["analytics-consent"],
		queryFn: getAnalyticsConsent,
	});
	const analyticsEnabled = analyticsConsent !== "denied";

	const { data: autostartEnabled = false, isPending: isAutostartLoading } =
		useQuery({
			queryKey: ["windows-autostart"],
			queryFn: isAutostartEnabled,
			enabled: isWindowsOS,
		});

	const { data: autoCheckUpdates = true, isPending: isAutoCheckLoading } =
		useQuery(autoCheckUpdatesQueryOptions());
	const { data: updateChannel = "stable", isPending: isChannelLoading } =
		useQuery(updateChannelQueryOptions());

	const analyticsMutation = useMutation({
		mutationFn: async (enabled: boolean) => {
			await saveAnalyticsPreference(enabled);
			return enabled;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["analytics-consent"],
			});
		},
		onError: (error) => {
			toast.danger(
				error instanceof Error
					? error.message
					: "Failed to update analytics consent",
			);
		},
	});

	const autostartMutation = useMutation({
		mutationFn: async (enabled: boolean) => {
			if (enabled) {
				await enableAutostart();
			} else {
				await disableAutostart();
			}
			return enabled;
		},
		onSuccess: (enabled) => {
			queryClient.invalidateQueries({
				queryKey: ["windows-autostart"],
			});
			toast.success(
				enabled
					? t("settingsAutostartEnabled")
					: t("settingsAutostartDisabled"),
			);
		},
		onError: (error) => {
			toast.danger(
				error instanceof Error
					? error.message
					: t("settingsAutostartError"),
			);
		},
	});

	const autoCheckUpdatesMutation = useMutation({
		...setAutoCheckUpdatesMutationOptions({
			queryClient,
			onSuccess: (enabled) => {
				toast.success(
					enabled
						? t("settingsAutoCheckUpdatesEnabled")
						: t("settingsAutoCheckUpdatesDisabled"),
				);
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error
					? error.message
					: t("settingsAutoCheckUpdatesError"),
			);
		},
	});

	const checkMutation = useMutation({
		mutationFn: checkForUpdate,
	});

	const updateChannelMutation = useMutation({
		...setUpdateChannelMutationOptions({
			queryClient,
			onSuccess: (channel) => {
				checkMutation.reset();
				toast.success(
					channel === "beta"
						? t("settingsBetaUpdatesEnabled")
						: t("settingsBetaUpdatesDisabled"),
				);
			},
		}),
		onError: (error) => {
			toast.danger(
				error instanceof Error
					? error.message
					: t("settingsBetaUpdatesError"),
			);
		},
	});

	const downloadMutation = useMutation({
		mutationFn: installUpdate,
		onSuccess: () => {
			toast.success(t("updateInstalledSuccess"), {
				timeout: 0,
				actionProps: {
					onPress: () => relaunch(),
					variant: "tertiary",
					children: t("restartNow"),
				},
				description: t("restartToUpdate"),
			});
		},
		onError: (error) => {
			toast.danger(`${t("updateError")}: ${error.message}`);
		},
	});

	const handleCheckUpdates = () => {
		checkMutation.mutate();
	};

	const handleDownloadAndInstall = () => {
		if (checkMutation.data) {
			downloadMutation.mutate(checkMutation.data);
		}
	};

	const availableUpdate = checkMutation.data ?? null;
	const hasCheckedForUpdates = checkMutation.data !== undefined;
	const isChecking = checkMutation.isPending;
	const isDownloading = downloadMutation.isPending;
	const hasError = checkMutation.isError || downloadMutation.isError;
	const errorMessage =
		checkMutation.error?.message || downloadMutation.error?.message;

	const teamMembers = [
		{
			name: "AkaraChen",
			role: t("headDev"),
			avatar: "https://avatars.githubusercontent.com/u/85140972?v=4",
			githubUrl: "https://github.com/AkaraChen",
		},
		{
			name: "Flacier",
			role: t("developer"),
			avatar: "https://avatars.githubusercontent.com/u/48170241?v=4",
			githubUrl: "https://github.com/Fldicoahkiin",
		},
		{
			name: "danielchim",
			role: t("designer"),
			avatar: "https://avatars.githubusercontent.com/u/12156547?v=4",
			githubUrl: "https://github.com/danielchim",
		},
	];

	return (
		<div className="space-y-4">
			<Card className="p-0">
				<Card.Content className="space-y-4 p-4">
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("appName")}
							</span>
							<span className="block text-xs text-muted">
								{appInfo?.name ?? "aghub"}
							</span>
						</div>
					</div>

					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("version")}
							</span>
							<span className="block text-xs text-muted">
								{appInfo?.version ?? "0.1.0"}
							</span>
						</div>
					</div>

					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("updates")}
							</span>
							<span className="block text-xs text-muted">
								{hasError &&
									`${t("updateError")}: ${errorMessage}`}
								{isChecking && t("checkingForUpdates")}
								{isDownloading && t("downloadingUpdate")}
								{!isChecking &&
									!isDownloading &&
									!hasError &&
									availableUpdate &&
									t("updateAvailable", {
										version: availableUpdate.version,
									})}
								{!isChecking &&
									!isDownloading &&
									!hasError &&
									hasCheckedForUpdates &&
									!availableUpdate &&
									t("noUpdatesAvailable")}
								{!isChecking &&
									!isDownloading &&
									!hasError &&
									!hasCheckedForUpdates &&
									t("clickToCheckUpdates")}
							</span>
						</div>
						<div className="flex gap-2">
							{!hasCheckedForUpdates && (
								<Button
									variant="secondary"
									size="sm"
									onPress={handleCheckUpdates}
									isDisabled={isChecking || isDownloading}
								>
									{t("checkForUpdates")}
								</Button>
							)}
							{hasCheckedForUpdates && !availableUpdate && (
								<Button
									variant="secondary"
									size="sm"
									onPress={handleCheckUpdates}
									isDisabled={isChecking || isDownloading}
								>
									{t("checkAgain")}
								</Button>
							)}
							{availableUpdate && (
								<Button
									variant="primary"
									size="sm"
									onPress={handleDownloadAndInstall}
									isDisabled={isDownloading}
								>
									{t("downloadAndInstall")}
								</Button>
							)}
						</div>
					</div>

					<div className="flex items-center justify-between gap-4">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("settingsAutoCheckUpdatesHeading")}
							</span>
							<span className="block text-xs text-muted">
								{t("settingsAutoCheckUpdatesDescription")}
							</span>
						</div>
						<Switch
							isSelected={autoCheckUpdates}
							onChange={(checked) =>
								autoCheckUpdatesMutation.mutate(checked)
							}
							isDisabled={
								isAutoCheckLoading ||
								autoCheckUpdatesMutation.isPending
							}
							aria-label={t(
								"settingsAutoCheckUpdatesToggleLabel",
							)}
						>
							<Switch.Content>
								<Switch.Control>
									<Switch.Thumb />
								</Switch.Control>
							</Switch.Content>
						</Switch>
					</div>

					<div className="flex items-center justify-between gap-4">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("settingsBetaUpdatesHeading")}
							</span>
							<span className="block text-xs text-muted">
								{t("settingsBetaUpdatesDescription")}
							</span>
						</div>
						<Switch
							isSelected={updateChannel === "beta"}
							onChange={(checked) =>
								updateChannelMutation.mutate(
									checked ? "beta" : "stable",
								)
							}
							isDisabled={
								isChannelLoading ||
								updateChannelMutation.isPending
							}
							aria-label={t("settingsBetaUpdatesToggleLabel")}
						>
							<Switch.Content>
								<Switch.Control>
									<Switch.Thumb />
								</Switch.Control>
							</Switch.Content>
						</Switch>
					</div>

					<div className="flex items-center justify-between gap-4">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("settingsAnalyticsHeading")}
							</span>
							<span className="block text-xs text-muted">
								{t("settingsAnalyticsDescription")}
							</span>
						</div>
						<Switch
							isSelected={analyticsEnabled}
							onChange={(checked) =>
								analyticsMutation.mutate(checked)
							}
							isDisabled={analyticsMutation.isPending}
							aria-label={t("settingsAnalyticsToggleLabel")}
						>
							<Switch.Content>
								<Switch.Control>
									<Switch.Thumb />
								</Switch.Control>
							</Switch.Content>
						</Switch>
					</div>

					{isWindowsOS ? (
						<div className="flex items-center justify-between gap-4">
							<div className="space-y-0.5">
								<span className="text-sm font-medium text-(--foreground)">
									{t("settingsAutostartHeading")}
								</span>
								<span className="block text-xs text-muted">
									{t("settingsAutostartDescription")}
								</span>
							</div>
							<Switch
								isSelected={autostartEnabled}
								onChange={(checked) =>
									autostartMutation.mutate(checked)
								}
								isDisabled={
									isAutostartLoading ||
									autostartMutation.isPending
								}
								aria-label={t("settingsAutostartToggleLabel")}
							>
								<Switch.Content>
									<Switch.Control>
										<Switch.Thumb />
									</Switch.Control>
								</Switch.Content>
							</Switch>
						</div>
					) : null}

					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("onboarding")}
							</span>
							<span className="block text-xs text-muted">
								{t("onboardingDescription")}
							</span>
						</div>
						<div className="flex gap-2">
							<Button
								variant="secondary"
								size="sm"
								onPress={() =>
									dispatchOnboardingCommand({
										type: "show-welcome",
									})
								}
							>
								{t("showWelcome")}
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onPress={() =>
									dispatchOnboardingCommand({
										type: "start-tour",
										tour: "product-map",
									})
								}
							>
								{t("replayAppTour")}
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onPress={() =>
									dispatchOnboardingCommand({
										type: "start-tour",
										tour: "project-workflow",
									})
								}
							>
								{t("replayProjectTour")}
							</Button>
						</div>
					</div>
				</Card.Content>
			</Card>

			<Card className="p-0">
				<Card.Content className="p-4">
					<span className="text-sm font-medium text-(--foreground)">
						{t("team")}
					</span>
					<div className="mt-4 grid grid-cols-3 gap-4">
						{teamMembers.map((member) => (
							<button
								key={member.name}
								type="button"
								className="flex flex-col items-center text-center cursor-pointer"
								onClick={() => openUrl(member.githubUrl)}
							>
								<Avatar size="lg">
									<Avatar.Image
										src={member.avatar}
										alt={member.name}
									/>
								</Avatar>
								<span className="mt-2 text-sm font-medium">
									{member.name}
								</span>
								<span className="text-xs text-muted">
									{member.role}
								</span>
							</button>
						))}
					</div>
				</Card.Content>
			</Card>
		</div>
	);
}

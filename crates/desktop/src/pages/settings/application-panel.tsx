import { Avatar, Button, Card, toast } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getName, getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useTranslation } from "react-i18next";
import { dispatchOnboardingCommand } from "../../lib/onboarding";

export default function ApplicationPanel() {
	const { t } = useTranslation();

	const { data: appInfo } = useQuery({
		queryKey: ["app-info"],
		queryFn: async () => {
			const name = await getName();
			const version = await getVersion();
			return { name, version };
		},
	});

	const checkMutation = useMutation({
		mutationFn: async () => {
			const update = await check();
			if (update) {
				return {
					available: true,
					version: update.version,
					currentVersion: update.currentVersion,
				};
			}
			return { available: false };
		},
	});

	const downloadMutation = useMutation({
		mutationFn: async () => {
			const update = await check();
			if (!update) throw new Error("No update available");

			await update.downloadAndInstall();
		},
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
		downloadMutation.mutate();
	};

	const updateCheckResult = checkMutation.data;
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
									updateCheckResult?.available &&
									t("updateAvailable", {
										version: updateCheckResult.version,
									})}
								{!isChecking &&
									!isDownloading &&
									!hasError &&
									updateCheckResult &&
									!updateCheckResult.available &&
									t("noUpdatesAvailable")}
								{!isChecking &&
									!isDownloading &&
									!hasError &&
									!updateCheckResult &&
									t("clickToCheckUpdates")}
							</span>
						</div>
						<div className="flex gap-2">
							{!updateCheckResult && (
								<Button
									variant="secondary"
									size="sm"
									onPress={handleCheckUpdates}
									isDisabled={isChecking || isDownloading}
								>
									{t("checkForUpdates")}
								</Button>
							)}
							{updateCheckResult &&
								!updateCheckResult.available && (
									<Button
										variant="secondary"
										size="sm"
										onPress={handleCheckUpdates}
										isDisabled={isChecking || isDownloading}
									>
										{t("checkAgain")}
									</Button>
								)}
							{updateCheckResult?.available && (
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

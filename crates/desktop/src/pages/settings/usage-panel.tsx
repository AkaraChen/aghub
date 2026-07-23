import { AlertDialog, Button, Card, toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import { useUsageSettingsEditor } from "../../hooks/use-usage-settings";
import { createDefaultUsageSettings } from "../../lib/store";
import { setUsageRuntimeMutationOptions } from "../../requests/usage";
import { AdvancedSection } from "./usage-advanced-section";
import { TrackedAgentsSection } from "./usage-agents-section";
import { AlertsSection } from "./usage-alerts-section";
import { HomeCardsSection } from "./usage-home-section";
import { UsageRuntimeSection } from "./usage-runtime-section";

export default function UsagePanel() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const {
		data: current,
		update: updateSettings,
		updateAsync: updateSettingsAsync,
		isPending: isSettingsPending,
		isSaving: isSettingsSaving,
		isError: isSettingsError,
		error: settingsError,
	} = useUsageSettingsEditor();
	const [isResetOpen, setIsResetOpen] = useState(false);
	const [isRestorePending, setIsRestorePending] = useState(false);
	const [layoutTarget, setLayoutTarget] = useState("default");
	const restoreInFlightRef = useRef(false);
	const resetRuntimeMutation = useMutation(
		setUsageRuntimeMutationOptions({ api, queryClient }),
	);
	const isRestoreDisabled = isSettingsSaving || isRestorePending;

	const restoreDefaults = async () => {
		if (restoreInFlightRef.current) return;
		restoreInFlightRef.current = true;
		setIsRestorePending(true);
		const previousSettings = current;
		try {
			try {
				await updateSettingsAsync(() => createDefaultUsageSettings());
			} catch {
				return;
			}

			try {
				await resetRuntimeMutation.mutateAsync({
					source: "auto",
					path: null,
				});
			} catch (error) {
				toast.danger(
					error instanceof Error
						? error.message
						: t("usageRuntimeStatusUnavailable"),
				);
				try {
					await updateSettingsAsync(() => previousSettings);
				} catch {
					return;
				}
				return;
			}

			setLayoutTarget("default");
			setIsResetOpen(false);
		} finally {
			restoreInFlightRef.current = false;
			setIsRestorePending(false);
		}
	};

	if (isSettingsPending) {
		return (
			<Card className="p-4" aria-busy>
				<p className="text-sm text-muted">{t("usageStatusChecking")}</p>
			</Card>
		);
	}

	if (isSettingsError) {
		return (
			<Card className="p-4">
				<p className="text-sm text-danger">
					{settingsError instanceof Error
						? settingsError.message
						: t("usageSettingsLoadError")}
				</p>
			</Card>
		);
	}

	return (
		<>
			<Card className="gap-0 divide-y divide-border p-4">
				<UsageRuntimeSection />
				<HomeCardsSection
					current={current}
					updateSettings={updateSettings}
					layoutTarget={layoutTarget}
					onLayoutTargetChange={setLayoutTarget}
				/>
				<TrackedAgentsSection
					current={current}
					updateSettings={updateSettings}
				/>
				<AlertsSection
					current={current}
					updateSettings={updateSettings}
				/>
				<AdvancedSection
					current={current}
					updateSettings={updateSettings}
				/>
				<Card.Footer
					data-testid="usage-defaults-footer"
					className="flex-col items-stretch justify-between gap-3 px-1 pt-4 sm:flex-row sm:items-center"
				>
					<div className="min-w-0 space-y-0.5">
						<p className="text-sm font-medium text-(--foreground)">
							{t("usageDefaultsHeading")}
						</p>
						<p className="text-xs text-muted">
							{t("usageDefaultsDescription")}
						</p>
					</div>
					<Button
						size="sm"
						variant="ghost"
						onPress={() => setIsResetOpen(true)}
						isDisabled={isRestoreDisabled}
						aria-label={t("usageRestoreDefaults")}
						className="shrink-0"
					>
						{t("usageRestoreDefaultsAction")}
					</Button>
				</Card.Footer>
			</Card>
			<UsageDefaultsDialog
				isOpen={isResetOpen}
				onOpenChange={setIsResetOpen}
				onRestore={restoreDefaults}
				isPending={isRestorePending}
			/>
		</>
	);
}

function UsageDefaultsDialog({
	isOpen,
	onOpenChange,
	onRestore,
	isPending,
}: {
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onRestore: () => Promise<void>;
	isPending: boolean;
}) {
	const { t } = useTranslation();
	const handleOpenChange = (nextOpen: boolean) => {
		if (!isPending || nextOpen) onOpenChange(nextOpen);
	};
	return (
		<AlertDialog.Backdrop
			isOpen={isOpen}
			onOpenChange={handleOpenChange}
			isKeyboardDismissDisabled={isPending}
		>
			<AlertDialog.Container>
				<AlertDialog.Dialog className="sm:max-w-[420px]">
					{!isPending && <AlertDialog.CloseTrigger />}
					<AlertDialog.Header>
						<AlertDialog.Heading>
							{t("usageRestoreDefaults")}
						</AlertDialog.Heading>
					</AlertDialog.Header>
					<AlertDialog.Body>
						{t("usageRestoreDefaultsConfirm")}
					</AlertDialog.Body>
					<AlertDialog.Footer>
						<Button
							variant="tertiary"
							onPress={() => onOpenChange(false)}
							isDisabled={isPending}
						>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							onPress={() => void onRestore()}
							isPending={isPending}
						>
							{t("usageRestoreDefaultsAction")}
						</Button>
					</AlertDialog.Footer>
				</AlertDialog.Dialog>
			</AlertDialog.Container>
		</AlertDialog.Backdrop>
	);
}

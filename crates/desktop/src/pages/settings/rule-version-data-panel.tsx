import {
	AlertDialog,
	Button,
	Card,
	FieldError,
	Form,
	NumberField,
	Switch,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RuleVersionPreferencesResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import {
	clearRuleVersionsMutationOptions,
	ruleVersionPreferencesQueryOptions,
	ruleVersionStorageQueryOptions,
	updateRuleVersionPreferencesMutationOptions,
} from "../../requests/rules";

export default function RuleVersionDataPanel() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const storageQuery = useQuery(ruleVersionStorageQueryOptions({ api }));
	const preferencesQuery = useQuery(
		ruleVersionPreferencesQueryOptions({ api }),
	);
	const preferencesMutation = useMutation({
		...updateRuleVersionPreferencesMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("ruleVersionPreferencesSaved"));
			},
		}),
		onError: (error) => {
			console.error("Failed to save rule version preferences:", error);
			toast.danger(t("ruleVersionPreferencesSaveFailed"));
		},
	});
	const clearMutation = useMutation({
		...clearRuleVersionsMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				setIsConfirmOpen(false);
				toast.success(t("ruleVersionsCleared"));
			},
		}),
		onError: (error) => {
			console.error("Failed to clear rule version history:", error);
			toast.danger(t("ruleVersionsClearFailed"));
		},
	});

	return (
		<>
			<div
				data-testid="rule-version-data-panel"
				className="mx-auto max-w-4xl"
			>
				<Card className="p-0">
					<Card.Content className="space-y-5 p-4">
						<div className="space-y-0.5">
							<h3 className="text-sm font-medium text-foreground">
								{t("ruleVersionHistory")}
							</h3>
							<p className="text-xs text-muted">
								{t("ruleVersionHistoryDescription")}
							</p>
						</div>

						<div className="space-y-4 border-t border-separator pt-4">
							{preferencesQuery.isPending ? (
								<p className="text-xs text-muted">
									{t("loading")}
								</p>
							) : preferencesQuery.isError ? (
								<p className="text-xs text-danger">
									{t("ruleVersionDataUnavailable")}
								</p>
							) : (
								<RuleVersionPreferencesForm
									key={`${preferencesQuery.data.enabled}:${preferencesQuery.data.max_versions_per_file}`}
									preferences={preferencesQuery.data}
									isPending={preferencesMutation.isPending}
									onSave={(preferences) =>
										preferencesMutation.mutate(preferences)
									}
								/>
							)}

							<section
								aria-labelledby="rule-version-storage-heading"
								className="flex flex-col gap-2 border-t border-separator pt-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
							>
								<h4
									id="rule-version-storage-heading"
									className="shrink-0 text-sm font-medium text-foreground"
								>
									{t("ruleVersionStorageLocation")}
								</h4>
								<p className="min-w-0 break-all font-mono text-xs text-muted sm:max-w-[75%] sm:text-right">
									{storageQuery.isPending
										? t("loading")
										: storageQuery.isError
											? t("ruleVersionDataUnavailable")
											: storageQuery.data.file_path}
								</p>
							</section>
							<section className="flex flex-col gap-3 border-t border-separator pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
								<div className="min-w-0 space-y-0.5">
									<h4 className="text-sm font-medium text-foreground">
										{t("clearRuleVersions")}
									</h4>
									<p className="text-xs text-muted">
										{t("clearRuleVersionsDescription")}
									</p>
								</div>
								<Button
									variant="danger"
									size="sm"
									className="shrink-0"
									onPress={() => setIsConfirmOpen(true)}
								>
									{t("clearRuleVersions")}
								</Button>
							</section>
						</div>
					</Card.Content>
				</Card>
			</div>

			<AlertDialog.Backdrop
				isOpen={isConfirmOpen}
				onOpenChange={setIsConfirmOpen}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("clearRuleVersionsConfirmTitle")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							<p className="text-sm text-muted">
								{t("clearRuleVersionsConfirmDescription")}
							</p>
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								isDisabled={clearMutation.isPending}
								onPress={() => setIsConfirmOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={clearMutation.isPending}
								onPress={() => clearMutation.mutate()}
							>
								{t("clearRuleVersionsConfirmAction")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</>
	);
}

function RuleVersionPreferencesForm({
	preferences,
	isPending,
	onSave,
}: {
	preferences: RuleVersionPreferencesResponse;
	isPending: boolean;
	onSave: (preferences: {
		enabled: boolean;
		max_versions_per_file: number;
	}) => void;
}) {
	const { t } = useTranslation();
	const [enabled, setEnabled] = useState(preferences.enabled);
	const [retention, setRetention] = useState<number | undefined>(
		preferences.max_versions_per_file,
	);
	const isRetentionValid =
		retention !== undefined &&
		retention >= preferences.min_versions_per_file &&
		retention <= preferences.max_supported_versions_per_file;
	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!isRetentionValid) return;
		onSave({
			enabled,
			max_versions_per_file: retention,
		});
	};

	return (
		<Form
			validationBehavior="aria"
			className="space-y-4"
			onSubmit={handleSubmit}
		>
			<div className="flex items-center justify-between gap-4">
				<div className="min-w-0 space-y-0.5">
					<p className="text-sm font-medium text-foreground">
						{t("ruleVersionAutomaticRecording")}
					</p>
					<p className="text-xs text-muted">
						{t("ruleVersionAutomaticRecordingDescription")}
					</p>
				</div>
				<Switch
					aria-label={t("ruleVersionAutomaticRecording")}
					isSelected={enabled}
					isDisabled={isPending}
					onChange={setEnabled}
				>
					<Switch.Content>
						<Switch.Control>
							<Switch.Thumb />
						</Switch.Control>
					</Switch.Content>
				</Switch>
			</div>

			<div className="flex flex-col gap-3 border-t border-separator pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
				<div className="min-w-0 space-y-0.5">
					<p className="text-sm font-medium text-foreground">
						{t("ruleVersionRetention")}
					</p>
					<p className="text-xs text-muted">
						{t("ruleVersionRetentionDescription")}
					</p>
				</div>
				<NumberField
					aria-label={t("ruleVersionRetention")}
					variant="secondary"
					value={retention}
					minValue={preferences.min_versions_per_file}
					maxValue={preferences.max_supported_versions_per_file}
					isInvalid={!isRetentionValid}
					isDisabled={!enabled || isPending}
					onChange={setRetention}
					className="w-40 shrink-0"
				>
					<NumberField.Group>
						<NumberField.DecrementButton />
						<NumberField.Input />
						<NumberField.IncrementButton />
					</NumberField.Group>
					<FieldError>
						{t("ruleVersionRetentionError", {
							min: preferences.min_versions_per_file,
							max: preferences.max_supported_versions_per_file,
						})}
					</FieldError>
				</NumberField>
			</div>

			<div className="flex justify-end border-t border-separator pt-4">
				<Button
					type="submit"
					size="sm"
					isPending={isPending}
					isDisabled={!isRetentionValid}
				>
					{t("saveRuleVersionPreferences")}
				</Button>
			</div>
		</Form>
	);
}

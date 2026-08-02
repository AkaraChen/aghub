import {
	Card,
	Switch,
	toast,
	ToggleButton,
	ToggleButtonGroup,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { SkillCopyCheckMode } from "../../lib/store";
import {
	setSkillCopyCheckPreferenceMutationOptions,
	skillCopyCheckPreferenceQueryOptions,
} from "../../requests/preferences";

export default function SkillPreferencesPanel() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const {
		data: skillCopyCheck = { enabled: true, mode: "automatic" },
		isPending: isCopyCheckPending,
	} = useQuery(skillCopyCheckPreferenceQueryOptions());
	const copyCheckMutation = useMutation({
		...setSkillCopyCheckPreferenceMutationOptions(queryClient),
		onError: () => toast.danger(t("skillCopyCheckPreferenceError")),
	});

	return (
		<Card>
			<Card.Content className="space-y-4 p-4">
				<div className="flex items-center justify-between gap-4">
					<div className="space-y-1">
						<h3 className="text-sm font-medium text-foreground">
							{t("skillCopyCheck")}
						</h3>
						<p className="text-xs text-muted">
							{t("skillCopyCheckDescription")}
						</p>
					</div>
					<Switch
						aria-label={t("skillCopyCheck")}
						isDisabled={
							isCopyCheckPending || copyCheckMutation.isPending
						}
						isSelected={skillCopyCheck.enabled}
						onChange={(enabled) =>
							copyCheckMutation.mutate({
								...skillCopyCheck,
								enabled,
							})
						}
					>
						<Switch.Content>
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
						</Switch.Content>
					</Switch>
				</div>

				{skillCopyCheck.enabled && (
					<div className="flex items-center justify-between gap-4 border-t border-separator pt-4">
						<div className="space-y-1">
							<h3 className="text-sm font-medium text-foreground">
								{t("skillCopyCheckMode")}
							</h3>
							<p className="text-xs text-muted">
								{t("skillCopyCheckModeDescription")}
							</p>
						</div>
						<ToggleButtonGroup
							aria-label={t("skillCopyCheckMode")}
							selectedKeys={[skillCopyCheck.mode]}
							onSelectionChange={(keys) => {
								const mode = [...keys][0] as
									SkillCopyCheckMode | undefined;
								if (!mode) return;
								copyCheckMutation.mutate({
									...skillCopyCheck,
									mode,
								});
							}}
							selectionMode="single"
							disallowEmptySelection
							isDisabled={copyCheckMutation.isPending}
							size="sm"
						>
							<ToggleButton id="automatic">
								{t("automatic")}
							</ToggleButton>
							<ToggleButton id="manual">
								<ToggleButtonGroup.Separator />
								{t("manual")}
							</ToggleButton>
						</ToggleButtonGroup>
					</div>
				)}

				<p className="text-xs text-muted">
					{t("skillCopyCheckWriteHint")}
				</p>
			</Card.Content>
		</Card>
	);
}

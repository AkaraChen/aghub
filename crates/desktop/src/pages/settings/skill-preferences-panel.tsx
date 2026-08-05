import {
	Card,
	ListBox,
	Select,
	Switch,
	toast,
	ToggleButton,
	ToggleButtonGroup,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
	DEFAULT_SKILL_PREFERENCES,
	type SkillCopyCheckMode,
	type SkillPreferences,
} from "../../lib/store";
import {
	setSkillPreferencesMutationOptions,
	skillPreferencesQueryOptions,
} from "../../requests/preferences";

const BASELINE_OPTIONS = [
	{ id: "claude", label: "Claude", path: "~/.claude/skills" },
	{ id: "codex", label: "Codex", path: "~/.codex/skills" },
] as const;

export default function SkillPreferencesPanel() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: preferences = DEFAULT_SKILL_PREFERENCES, isPending } =
		useQuery(skillPreferencesQueryOptions());
	const mutation = useMutation({
		...setSkillPreferencesMutationOptions(queryClient),
		onError: () => toast.danger(t("skillPreferencesError")),
	});
	const isDisabled = isPending || mutation.isPending;
	const save = (next: SkillPreferences) => mutation.mutate(next);

	return (
		<Card>
			<Card.Content className="divide-y divide-separator p-4">
				<section className="space-y-4 pb-4">
					<div className="flex items-center justify-between gap-4">
						<SettingText
							title={t("skillChangeChecks")}
							description={t("skillChangeChecksDescription")}
						/>
						<Switch
							aria-label={t("skillChangeChecks")}
							isDisabled={isDisabled}
							isSelected={preferences.enabled}
							onChange={(enabled) =>
								save({ ...preferences, enabled })
							}
						>
							<Switch.Content>
								<Switch.Control>
									<Switch.Thumb />
								</Switch.Control>
							</Switch.Content>
						</Switch>
					</div>

					{preferences.enabled && (
						<div className="flex items-center justify-between gap-4">
							<span className="text-sm text-muted">
								{t("skillChangeCheckTiming")}
							</span>
							<ToggleButtonGroup
								aria-label={t("skillChangeCheckTiming")}
								selectedKeys={[preferences.mode]}
								onSelectionChange={(keys) => {
									const mode = [...keys][0] as
										SkillCopyCheckMode | undefined;
									if (mode) save({ ...preferences, mode });
								}}
								selectionMode="single"
								disallowEmptySelection
								isDisabled={isDisabled}
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
				</section>

				<section className="space-y-3 py-4">
					<SettingText
						title={t("duplicateSkillManagement")}
						description={t("duplicateSkillManagementDescription")}
					/>
					<div className="grid gap-3 sm:grid-cols-2">
						<PreferenceSwitch
							label={t("groupIdenticalSkillCopies")}
							description={t(
								"groupIdenticalSkillCopiesDescription",
							)}
							selected={preferences.groupIdenticalCopies}
							disabled={isDisabled}
							onChange={(groupIdenticalCopies) =>
								save({
									...preferences,
									groupIdenticalCopies,
								})
							}
						/>
						<PreferenceSwitch
							label={t("warnOnSkillConflicts")}
							description={t("warnOnSkillConflictsDescription")}
							selected={preferences.warnOnConflicts}
							disabled={isDisabled}
							onChange={(warnOnConflicts) =>
								save({ ...preferences, warnOnConflicts })
							}
						/>
					</div>
				</section>

				<section className="flex items-center justify-between gap-4 pt-4">
					<SettingText
						title={t("skillBaselineLocation")}
						description={t("skillBaselineLocationDescription")}
					/>
					<Select
						variant="secondary"
						aria-label={t("skillBaselineLocation")}
						selectedKey={preferences.baselineAgent}
						onSelectionChange={(key) => {
							const baselineAgent = String(key);
							if (
								baselineAgent !== "claude" &&
								baselineAgent !== "codex"
							) {
								return;
							}
							save({
								...preferences,
								baselineAgent,
							});
						}}
						isDisabled={isDisabled}
						className="w-64 shrink-0"
					>
						<Select.Trigger>
							<Select.Value />
							<Select.Indicator />
						</Select.Trigger>
						<Select.Popover>
							<ListBox>
								{BASELINE_OPTIONS.map((option) => (
									<ListBox.Item
										key={option.id}
										id={option.id}
										textValue={`${option.label} ${option.path}`}
									>
										<div className="min-w-0">
											<p>{option.label}</p>
											<p className="font-mono text-xs text-muted">
												{option.path}
											</p>
										</div>
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>
				</section>
			</Card.Content>
		</Card>
	);
}

function SettingText({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="min-w-0 space-y-1">
			<h3 className="text-sm font-medium text-foreground">{title}</h3>
			<p className="text-xs text-muted">{description}</p>
		</div>
	);
}

function PreferenceSwitch({
	label,
	description,
	selected,
	disabled,
	onChange,
}: {
	label: string;
	description: string;
	selected: boolean;
	disabled: boolean;
	onChange: (selected: boolean) => void;
}) {
	return (
		<Switch isSelected={selected} isDisabled={disabled} onChange={onChange}>
			<Switch.Content className="items-start">
				<Switch.Control className="mt-0.5">
					<Switch.Thumb />
				</Switch.Control>
				<span className="space-y-0.5">
					<span className="block text-sm text-foreground">
						{label}
					</span>
					<span className="block text-xs text-muted">
						{description}
					</span>
				</span>
			</Switch.Content>
		</Switch>
	);
}

import {
	DocumentDuplicateIcon,
	FolderOpenIcon,
	LinkIcon,
	MagnifyingGlassIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
import {
	Chip,
	RadioGroup,
	Surface,
	ToggleButton,
	ToggleButtonGroup,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { UniversalSkillTargetIcon } from "../../components/universal-skill-target-icon";
import type { SkillCopyCheckMode, SkillPreferences } from "../../lib/store";
import {
	SkillPreferenceChoice,
	SkillPreferenceLabel,
	SkillPreferenceRadio,
	SkillPreferenceSection,
	SkillPreferenceSwitch,
} from "./skill-preference-fields";

interface PreferenceSectionProps {
	preferences: SkillPreferences;
	isDisabled: boolean;
	onChange: (preferences: SkillPreferences) => void;
}

type CopyCheckSelection = SkillCopyCheckMode | "off";

export function SkillInstallationPreferences({
	universalTargetLabel,
}: {
	universalTargetLabel: string;
}) {
	const { t } = useTranslation();

	return (
		<SkillPreferenceSection
			title={t("skillInstallation")}
			description={t("skillInstallationDescription")}
			icon={<FolderOpenIcon className="size-4" />}
		>
			<Surface variant="secondary" className="min-w-0 rounded-xl p-3">
				<div className="flex min-w-0 items-center gap-3">
					<UniversalSkillTargetIcon className="size-9 rounded-lg bg-surface" />
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 items-center gap-2">
							<span className="truncate whitespace-nowrap text-sm font-medium">
								{universalTargetLabel}
							</span>
							<Chip size="sm" variant="tertiary">
								{t("defaultLabel")}
							</Chip>
						</div>
						<p className="mt-0.5 truncate text-xs text-muted">
							{t("universalAgentTargetPathHint")}
						</p>
					</div>
					<code className="shrink-0 text-xs text-muted">
						~/.agents/skills
					</code>
				</div>
			</Surface>
			<Surface variant="secondary" className="min-w-0 rounded-xl p-3">
				<div className="flex min-w-0 items-start gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
						<RectangleStackIcon className="size-4" />
					</div>
					<div className="min-w-0 space-y-0.5">
						<p className="text-sm font-medium text-foreground">
							{t("nativeAgentTargets")}
						</p>
						<p className="text-xs leading-5 text-muted">
							{t("nativeAgentTargetsDescription")}
						</p>
					</div>
				</div>
			</Surface>
			<p className="text-xs leading-5 text-muted">
				{t("skillStorageNotice")}
			</p>
		</SkillPreferenceSection>
	);
}

export function SkillRelationshipPreferences({
	preferences,
	isDisabled,
	onChange,
}: PreferenceSectionProps) {
	const { t } = useTranslation();

	return (
		<SkillPreferenceSection
			title={t("skillFileRelationships")}
			description={t("skillFileRelationshipsDescription")}
			icon={<DocumentDuplicateIcon className="size-4" />}
		>
			<div className="space-y-2">
				<SkillPreferenceLabel>
					{t("defaultSkillFileHandling")}
				</SkillPreferenceLabel>
				<p className="text-xs text-muted">
					{t("defaultSkillFileHandlingDescription")}
				</p>
				<RadioGroup
					aria-label={t("defaultSkillFileHandling")}
					value={preferences.defaultStorageMode}
					onChange={(mode) => {
						if (mode === "preserve" || mode === "copy") {
							onChange({
								...preferences,
								defaultStorageMode: mode,
							});
						}
					}}
					isDisabled={isDisabled}
					className="grid gap-2"
				>
					<SkillPreferenceRadio
						value="preserve"
						icon={<LinkIcon className="size-4" />}
						label={t("preserveFileRelationships")}
						description={t("preserveFileRelationshipsDescription")}
					/>
					<SkillPreferenceRadio
						value="copy"
						icon={<DocumentDuplicateIcon className="size-4" />}
						label={t("copySkillFileContents")}
						description={t("copySkillFileContentsDescription")}
					/>
				</RadioGroup>
			</div>
		</SkillPreferenceSection>
	);
}

export function SkillContentPreferences({
	preferences,
	isDisabled,
	onChange,
}: PreferenceSectionProps) {
	const { t } = useTranslation();
	const copyCheckSelection: CopyCheckSelection = preferences.enabled
		? preferences.mode
		: "off";

	return (
		<SkillPreferenceSection
			title={t("skillContentChecks")}
			description={t("skillContentChecksDescription")}
			icon={<MagnifyingGlassIcon className="size-4" />}
		>
			<SkillPreferenceChoice
				title={t("skillChangeCheckTiming")}
				description={t("skillChangeChecksDescription")}
			>
				<ToggleButtonGroup
					aria-label={t("skillChangeChecks")}
					selectedKeys={[copyCheckSelection]}
					onSelectionChange={(keys) => {
						const selection = [...keys][0] as
							CopyCheckSelection | undefined;
						if (!selection) return;
						if (selection === "off") {
							onChange({ ...preferences, enabled: false });
							return;
						}
						onChange({
							...preferences,
							enabled: true,
							mode: selection,
						});
					}}
					selectionMode="single"
					disallowEmptySelection
					isDisabled={isDisabled}
					size="sm"
				>
					<ToggleButton id="automatic">{t("automatic")}</ToggleButton>
					<ToggleButton id="manual">
						<ToggleButtonGroup.Separator />
						{t("manual")}
					</ToggleButton>
					<ToggleButton id="off">
						<ToggleButtonGroup.Separator />
						{t("off")}
					</ToggleButton>
				</ToggleButtonGroup>
			</SkillPreferenceChoice>
			<div className="space-y-2">
				<SkillPreferenceLabel>
					{t("duplicateSkillManagement")}
				</SkillPreferenceLabel>
				<p className="text-xs text-muted">
					{t("duplicateSkillManagementDescription")}
				</p>
				<Surface
					variant="secondary"
					className="divide-y divide-separator rounded-xl px-3"
				>
					<SkillPreferenceSwitch
						label={t("groupIdenticalSkillCopies")}
						description={t("groupIdenticalSkillCopiesDescription")}
						selected={preferences.groupIdenticalCopies}
						disabled={isDisabled || !preferences.enabled}
						onChange={(groupIdenticalCopies) =>
							onChange({ ...preferences, groupIdenticalCopies })
						}
					/>
					<SkillPreferenceSwitch
						label={t("warnOnSkillConflicts")}
						description={t("warnOnSkillConflictsDescription")}
						selected={preferences.warnOnConflicts}
						disabled={isDisabled || !preferences.enabled}
						onChange={(warnOnConflicts) =>
							onChange({ ...preferences, warnOnConflicts })
						}
					/>
				</Surface>
			</div>
			<SkillPreferenceChoice
				title={t("unreadableSkillCopies")}
				description={t("unreadableSkillCopiesDescription")}
			>
				<Chip size="sm" variant="tertiary">
					{t("alwaysReported")}
				</Chip>
			</SkillPreferenceChoice>
		</SkillPreferenceSection>
	);
}

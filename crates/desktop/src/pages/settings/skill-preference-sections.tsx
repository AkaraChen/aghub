import {
	DocumentDuplicateIcon,
	LinkIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/solid";
import {
	RadioGroup,
	Surface,
	ToggleButton,
	ToggleButtonGroup,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
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
		</SkillPreferenceSection>
	);
}

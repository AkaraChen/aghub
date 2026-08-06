import {
	ArchiveBoxIcon,
	FolderOpenIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
import { Chip, Surface } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { SkillPreferences } from "../../lib/store";
import {
	SkillDiscoveryCheckbox,
	SkillPreferenceSection,
} from "./skill-preference-fields";

interface SkillDiscoveryPreferencesProps {
	preferences: SkillPreferences;
	isDisabled: boolean;
	onChange: (preferences: SkillPreferences) => void;
}

export function SkillDiscoveryPreferences({
	preferences,
	isDisabled,
	onChange,
}: SkillDiscoveryPreferencesProps) {
	const { t } = useTranslation();

	return (
		<SkillPreferenceSection
			title={t("skillDiscoveryScope")}
			description={t("skillDiscoveryScopeDescription")}
			icon={<FolderOpenIcon className="size-4" />}
		>
			<Surface variant="secondary" className="min-w-0 rounded-xl p-3">
				<div className="flex min-w-0 items-start gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
						<FolderOpenIcon className="size-4" />
					</div>
					<div className="min-w-0 flex-1 space-y-0.5">
						<div className="flex items-center gap-2">
							<p className="text-sm font-medium text-foreground">
								{t("installedSkillLocations")}
							</p>
							<Chip size="sm" variant="tertiary">
								{t("alwaysScanned")}
							</Chip>
						</div>
						<p className="text-xs leading-5 text-muted">
							{t("installedSkillLocationsDescription")}
						</p>
					</div>
				</div>
			</Surface>
			<Surface
				variant="secondary"
				className="divide-y divide-separator rounded-xl"
			>
				<SkillDiscoveryCheckbox
					label={t("projectSkillLocations")}
					description={t("projectSkillLocationsDescription")}
					icon={<FolderOpenIcon className="size-4" />}
					selected={preferences.discovery.projectSkills}
					disabled={isDisabled}
					onChange={(projectSkills) =>
						onChange({
							...preferences,
							discovery: {
								...preferences.discovery,
								projectSkills,
							},
						})
					}
				/>
				<SkillDiscoveryCheckbox
					label={t("embeddedRepositorySkills")}
					description={t("embeddedRepositorySkillsDescription")}
					icon={<RectangleStackIcon className="size-4" />}
					selected={preferences.discovery.embeddedSkills}
					disabled={isDisabled}
					onChange={(embeddedSkills) =>
						onChange({
							...preferences,
							discovery: {
								...preferences.discovery,
								embeddedSkills,
								dependencySkills: embeddedSkills
									? preferences.discovery.dependencySkills
									: false,
							},
						})
					}
				/>
				<SkillDiscoveryCheckbox
					label={t("dependencyPackageSkills")}
					description={t("dependencyPackageSkillsDescription")}
					icon={<ArchiveBoxIcon className="size-4" />}
					selected={preferences.discovery.dependencySkills}
					disabled={
						isDisabled || !preferences.discovery.embeddedSkills
					}
					onChange={(dependencySkills) =>
						onChange({
							...preferences,
							discovery: {
								...preferences.discovery,
								dependencySkills,
							},
						})
					}
				/>
			</Surface>
		</SkillPreferenceSection>
	);
}

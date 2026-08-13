import {
	ArchiveBoxIcon,
	FolderOpenIcon,
	RectangleStackIcon,
} from "@heroicons/react/24/solid";
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
		>
			<div className="divide-y divide-separator">
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
			</div>
		</SkillPreferenceSection>
	);
}

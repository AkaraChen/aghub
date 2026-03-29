import { Checkbox, Label } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { Project } from "../lib/store";
import { ProjectSelector } from "./project-selector";

interface InstallTargetSelectorProps {
	installToProject: boolean;
	onInstallToProjectChange: (value: boolean) => void;
	selectedProjectId: string | null;
	onSelectedProjectIdChange: (id: string | null) => void;
	projects: Project[];
	canInstallToProject: boolean;
}

export function InstallTargetSelector({
	installToProject,
	onInstallToProjectChange,
	selectedProjectId,
	onSelectedProjectIdChange,
	projects,
	canInstallToProject,
}: InstallTargetSelectorProps) {
	const { t } = useTranslation();

	return (
		<div className="space-y-2">
			<Checkbox
				value="installToProject"
				isSelected={installToProject}
				isDisabled={!canInstallToProject}
				onChange={(isSelected) => onInstallToProjectChange(isSelected)}
				variant="secondary"
			>
				<Checkbox.Control>
					<Checkbox.Indicator />
				</Checkbox.Control>
				<Checkbox.Content className="flex flex-col items-start gap-0.5">
					<Label className="text-sm font-medium">
						{t("installToProject")}
					</Label>
					<span className="text-xs text-muted">
						{canInstallToProject
							? t("installToProjectDescription")
							: t("noProjectsHelp")}
					</span>
				</Checkbox.Content>
			</Checkbox>

			{installToProject && (
				<ProjectSelector
					projects={projects}
					selectedKey={selectedProjectId}
					onSelectionChange={onSelectedProjectIdChange}
				/>
			)}
		</div>
	);
}

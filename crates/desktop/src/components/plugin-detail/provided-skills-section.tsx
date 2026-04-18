"use client";

import { useTranslation } from "react-i18next";

interface PluginSkillSummary {
	name: string;
	description?: string | null;
}

interface ProvidedSkillsSectionProps {
	skills: PluginSkillSummary[];
}

export function ProvidedSkillsSection({ skills }: ProvidedSkillsSectionProps) {
	const { t } = useTranslation();

	if (skills.length === 0) {
		return null;
	}

	return (
		<div className="space-y-3">
			<h3 className="text-xs font-medium tracking-wider text-muted uppercase">
				{t("providedSkills")}
			</h3>
			<div className="space-y-2">
				{skills.map((skill) => (
					<div
						key={skill.name}
						className="rounded-lg bg-surface-secondary px-3 py-2"
					>
						<div className="min-w-0 space-y-0.5">
							<p className="truncate font-mono text-xs text-foreground">
								{skill.name}
							</p>
							{skill.description && (
								<p className="truncate text-[11px] text-muted">
									{skill.description}
								</p>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

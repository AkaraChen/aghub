"use client";

import { CodeBracketIcon } from "@heroicons/react/24/solid";
import { Button, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { CCPluginSkillInfo } from "../../generated/dto";

interface ProvidedSkillsSectionProps {
	skills: CCPluginSkillInfo[];
	onEditSkill?: (skillName: string) => void;
}

export function ProvidedSkillsSection({
	skills,
	onEditSkill,
}: ProvidedSkillsSectionProps) {
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
						className="rounded-lg border border-separator/70 bg-surface-secondary px-3 py-2.5"
					>
						<div className="min-w-0 space-y-1">
							<div className="flex items-start justify-between gap-2">
								<p className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">
									{skill.name}
								</p>
								{onEditSkill && (
									<Tooltip delay={0}>
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											className="size-8 shrink-0 text-muted"
											aria-label={t("editInEditor")}
											onPress={() =>
												onEditSkill(skill.name)
											}
										>
											<CodeBracketIcon className="size-4" />
										</Button>
										<Tooltip.Content>
											{t("editInEditor")}
										</Tooltip.Content>
									</Tooltip>
								)}
							</div>
							{skill.description && (
								<p className="line-clamp-2 text-xs leading-5 text-muted">
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

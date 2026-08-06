import type { TFunction } from "i18next";
import type { SkillResponse } from "../generated/dto";

export const UNIVERSAL_SKILL_TARGET_ID = "universal";

interface UniversalSkillAgent {
	display_name: string;
	skills_paths: {
		global_read: string[];
		project_read: string[];
	};
}

export function formatUniversalSkillTargetMembers(
	agents: readonly UniversalSkillAgent[],
	language: string,
	scope: "global" | "project" = "global",
): string {
	return new Intl.ListFormat(language, {
		style: "short",
		type: "conjunction",
	}).format(
		agents
			.filter((agent) =>
				(scope === "global"
					? agent.skills_paths.global_read
					: agent.skills_paths.project_read
				).some(isUniversalSkillPath),
			)
			.map((agent) => agent.display_name),
	);
}

export function getUniversalSkillTargetLabel(
	t: TFunction,
	members: string,
): string {
	return members
		? t("universalAgentTargetSummary", { agents: members })
		: t("universalAgentTarget");
}

export function formatSkillTargetName(
	t: TFunction,
	targetId: string,
	displayName?: string,
): string {
	if (targetId === UNIVERSAL_SKILL_TARGET_ID) {
		return t("universalAgentTarget");
	}
	if (displayName) {
		return displayName;
	}
	return targetId.charAt(0).toUpperCase() + targetId.slice(1).toLowerCase();
}

const UNIVERSAL_SKILLS_SEGMENT = /(?:^|\/)\.agents\/skills(?:\/|$)/;

export function isUniversalSkillPath(path: string): boolean {
	return UNIVERSAL_SKILLS_SEGMENT.test(path.replaceAll("\\", "/"));
}

export function skillTargetIds(skill: SkillResponse): Set<string> {
	const paths =
		skill.locations && skill.locations.length > 0
			? skill.locations.map((location) => location.source_path)
			: skill.source_path
				? [skill.source_path]
				: [];
	const targets = new Set<string>();
	if (paths.some(isUniversalSkillPath)) {
		targets.add(UNIVERSAL_SKILL_TARGET_ID);
	}
	if (
		skill.agent &&
		(paths.length === 0 ||
			paths.some((path) => !isUniversalSkillPath(path)))
	) {
		targets.add(skill.agent);
	}
	return targets;
}

export function skillSourceTargetId(skill: SkillResponse): string {
	const targets = skillTargetIds(skill);
	if (skill.agent && targets.has(skill.agent)) {
		return skill.agent;
	}
	if (targets.has(UNIVERSAL_SKILL_TARGET_ID)) {
		return UNIVERSAL_SKILL_TARGET_ID;
	}
	return skill.agent ?? "claude";
}

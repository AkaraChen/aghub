import type { AgentInfo } from "./api";

export type Scope = "global" | "project";

export interface SkillsPathGroup {
	id: string;
	label: string;
	isUniversal: boolean;
	agentIds: string[];
}

const UNIVERSAL_PROJECT_PATH = ".agents/skills";
const UNIVERSAL_GLOBAL_PATH = "~/.config/agents/skills";

export function getSkillsPathGroups(
	agents: AgentInfo[],
	scope: Scope,
): SkillsPathGroup[] {
	const groups = new Map<string, SkillsPathGroup>();

	for (const agent of agents) {
		if (!agent.capabilities.skills) continue;

		const groupId = getGroupId(agent, scope);

		if (!groups.has(groupId)) {
			groups.set(groupId, {
				id: groupId,
				label: getGroupLabel(groupId),
				isUniversal: isUniversalGroupId(groupId),
				agentIds: [],
			});
		}

		groups.get(groupId)!.agentIds.push(agent.id);
	}

	return Array.from(groups.values());
}

function getGroupId(agent: AgentInfo, scope: Scope): string {
	if (scope === "project" && agent.capabilities.universal_skills) {
		return UNIVERSAL_PROJECT_PATH;
	}
	if (scope === "global" && agent.capabilities.universal_skills) {
		return UNIVERSAL_GLOBAL_PATH;
	}
	const path =
		scope === "project"
			? agent.skills_paths.project
			: agent.skills_paths.global;
	return path ?? `none-${agent.id}`;
}

function getGroupLabel(groupId: string): string {
	if (isUniversalGroupId(groupId)) {
		return "Universal";
	}
	if (groupId.startsWith("none-")) {
		return `No skills path`;
	}
	return groupId;
}

function isUniversalGroupId(groupId: string): boolean {
	return (
		groupId === UNIVERSAL_PROJECT_PATH || groupId === UNIVERSAL_GLOBAL_PATH
	);
}

export function expandToAgents(
	selection: string[],
	groups: SkillsPathGroup[],
): string[] {
	const result: string[] = [];
	const groupMap = new Map<string, SkillsPathGroup>();

	for (const group of groups) {
		for (const agentId of group.agentIds) {
			groupMap.set(agentId, group);
		}
	}

	const seenGroups = new Set<string>();

	for (const id of selection) {
		const group = groupMap.get(id);
		if (group && group.isUniversal && group.agentIds.length > 1) {
			if (!seenGroups.has(group.id)) {
				seenGroups.add(group.id);
				result.push(...group.agentIds);
			}
		} else {
			result.push(id);
		}
	}

	return [...new Set(result)];
}

export const UNIVERSAL_GROUP_ID = "__universal__";

export function expandUniversalSelection(
	selection: string[],
	groups: SkillsPathGroup[],
): string[] {
	const result: string[] = [];
	const universalGroup = groups.find(
		(g) => g.isUniversal && g.agentIds.length > 1,
	);

	for (const id of selection) {
		if (id === UNIVERSAL_GROUP_ID && universalGroup) {
			result.push(...universalGroup.agentIds);
		} else {
			result.push(id);
		}
	}

	return [...new Set(result)];
}

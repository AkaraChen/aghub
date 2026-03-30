import type { AgentInfo } from "../lib/api";
import type {
	ConfigSource,
	SkillResponse,
	SkillTreeNodeResponse,
} from "../lib/api-types";
import { sortAgents } from "../lib/utils";

export interface LocationInstallation {
	id: string;
	agent: string;
	source: ConfigSource;
}

export interface LocationGroup {
	key: string;
	sourcePath: string;
	installations: LocationInstallation[];
	canonicalPath?: string;
}

export interface SkillGroup {
	name: string;
	items: SkillResponse[];
}

const SKILL_MARKDOWN_FILE = "SKILL.md";

export function getNodeChildren(
	node: SkillTreeNodeResponse,
): SkillTreeNodeResponse[] {
	return Array.isArray(node.children) ? node.children : [];
}

export function hasSupplementarySkillFiles(
	node: SkillTreeNodeResponse,
): boolean {
	return getNodeChildren(node).some((child) => {
		if (child.name !== SKILL_MARKDOWN_FILE) {
			return true;
		}

		return hasSupplementarySkillFiles(child);
	});
}

export function countTreeNodes(node: SkillTreeNodeResponse): number {
	return (
		getNodeChildren(node).length +
		getNodeChildren(node).reduce(
			(total, child) => total + countTreeNodes(child),
			0,
		)
	);
}

export function formatAgentName(agent: string): string {
	return agent.charAt(0).toUpperCase() + agent.slice(1).toLowerCase();
}

export function buildLocationGroups(
	items: SkillResponse[],
	allAgents: AgentInfo[],
): LocationGroup[] {
	const sortedAgents = sortAgents(
		items.flatMap((item) => (item.agent ? [item.agent] : [])),
		allAgents,
	);
	const agentOrder = new Map(
		sortedAgents.map((agent, index) => [agent, index]),
	);

	const map = new Map<
		string,
		{
			installations: LocationInstallation[];
			canonicalPath?: string;
		}
	>();

	for (const item of items) {
		if (!item.source_path || !item.agent || !item.source) {
			continue;
		}

		const existing = map.get(item.source_path);
		const installation = {
			id: `${item.agent}:${item.source}`,
			agent: item.agent,
			source: item.source,
		};

		if (existing) {
			existing.installations.push(installation);
			continue;
		}

		map.set(item.source_path, {
			installations: [installation],
			canonicalPath: item.canonical_path,
		});
	}

	return Array.from(map.entries())
		.map(([sourcePath, data]) => ({
			key: sourcePath,
			sourcePath,
			installations: data.installations.sort((a, b) => {
				const agentDelta =
					(agentOrder.get(a.agent) ?? Number.MAX_SAFE_INTEGER) -
					(agentOrder.get(b.agent) ?? Number.MAX_SAFE_INTEGER);
				if (agentDelta !== 0) {
					return agentDelta;
				}

				return a.source.localeCompare(b.source);
			}),
			canonicalPath: data.canonicalPath,
		}))
		.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

import * as pathe from "pathe";
import type {
	AgentInfo,
	ConfigSource,
	SkillResponse,
	SkillTreeNodeResponse,
} from "../generated/dto";
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
	canonicalPath?: string | null;
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

export function countTreeFiles(node: SkillTreeNodeResponse): number {
	return getNodeChildren(node).reduce(
		(total, child) =>
			total + (child.kind === "file" ? 1 : 0) + countTreeFiles(child),
		0,
	);
}

export function getInstalledSkillAuditPaths(items: SkillResponse[]): string[] {
	return Array.from(
		new Set(
			items.flatMap((item) =>
				item.source_path
					? [
							pathe.basename(item.source_path).toLowerCase() ===
							"skill.md"
								? pathe.dirname(item.source_path)
								: item.source_path,
						]
					: [],
			),
		),
	).sort();
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
			canonicalPath: item.canonical_path ?? undefined,
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

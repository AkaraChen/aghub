import type {
	AgentInfo,
	ConfigSource,
	SkillLinkStatusResponse,
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
	isSymlink: boolean;
}

export interface SkillGroup {
	name: string;
	items: SkillResponse[];
}

export interface SkillSourceLocation {
	sourcePath: string;
	isSymlink: boolean;
	agents: string[];
}

export interface SkillLinkSummary {
	total: number;
	problems: number;
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
			total +
			(child.kind === "directory" ? 0 : 1) +
			countTreeFiles(child),
		0,
	);
}

export function summarizeSkillLinks(
	node: SkillTreeNodeResponse,
): SkillLinkSummary {
	const statuses: Record<SkillLinkStatusResponse, number> = {
		valid: 0,
		broken: 0,
		outside_root: 0,
		unreadable: 0,
	};

	function visit(current: SkillTreeNodeResponse): void {
		if (current.link) {
			statuses[current.link.status] += 1;
		}
		for (const child of getNodeChildren(current)) {
			visit(child);
		}
	}

	visit(node);
	const total = Object.values(statuses).reduce(
		(sum, count) => sum + count,
		0,
	);

	return {
		total,
		problems: total - statuses.valid,
	};
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
			isSymlink: boolean;
		}
	>();

	for (const item of items) {
		if (!item.agent) continue;
		const locations =
			item.locations && item.locations.length > 0
				? item.locations
				: item.source_path && item.source
					? [
							{
								source_path: item.source_path,
								is_symlink: item.is_symlink,
								source: item.source,
							},
						]
					: [];

		for (const location of locations) {
			const existing = map.get(location.source_path);
			const installation = {
				id: `${item.agent}:${location.source}`,
				agent: item.agent,
				source: location.source,
			};

			if (existing) {
				existing.installations.push(installation);
				existing.isSymlink ||= location.is_symlink;
				continue;
			}

			map.set(location.source_path, {
				installations: [installation],
				isSymlink: location.is_symlink,
			});
		}
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
			isSymlink: data.isSymlink,
		}))
		.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

export function uniqueSkillSourcePaths(items: SkillResponse[]): string[] {
	const paths = new Map<string, string>();
	for (const item of items) {
		const locations =
			item.locations && item.locations.length > 0
				? item.locations
				: item.source_path
					? [
							{
								source_path: item.source_path,
								is_symlink: item.is_symlink,
							},
						]
					: [];
		for (const location of locations) {
			if (!paths.has(location.source_path)) {
				paths.set(location.source_path, location.source_path);
			}
		}
	}
	return Array.from(paths.values()).sort((a, b) => a.localeCompare(b));
}

export function uniqueSkillLocations(
	items: SkillResponse[],
): SkillSourceLocation[] {
	const locations = new Map<string, SkillSourceLocation>();
	for (const item of items) {
		const itemLocations =
			item.locations && item.locations.length > 0
				? item.locations
				: item.source_path
					? [
							{
								source_path: item.source_path,
								is_symlink: item.is_symlink,
							},
						]
					: [];
		for (const location of itemLocations) {
			const existing = locations.get(location.source_path);
			if (existing) {
				if (item.agent && !existing.agents.includes(item.agent)) {
					existing.agents.push(item.agent);
				}
				continue;
			}
			locations.set(location.source_path, {
				sourcePath: location.source_path,
				isSymlink: location.is_symlink,
				agents: item.agent ? [item.agent] : [],
			});
		}
	}
	return Array.from(locations.values()).sort((a, b) =>
		a.sourcePath.localeCompare(b.sourcePath),
	);
}

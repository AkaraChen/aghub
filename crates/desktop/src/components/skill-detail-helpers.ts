import * as pathe from "pathe";
import type {
	AgentInfo,
	ConfigSource,
	SkillLinkStatusResponse,
	SkillProviderResponse,
	SkillResponse,
	SkillTreeNodeResponse,
} from "../generated/dto";
import { sortAgents } from "../lib/utils";

export interface LocationInstallation {
	id: string;
	agent: string;
	displayName: string;
	source: ConfigSource;
	provider?: SkillProviderResponse;
}

export interface LocationGroup {
	key: string;
	sourcePath: string;
	installations: LocationInstallation[];
	isSymlink: boolean;
	managed: boolean;
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

export interface ContainedSkill {
	name: string;
	displayName: string | null;
	relativePath: string;
}

const SKILL_MARKDOWN_FILE = "SKILL.md";

export function skillProviderIdentity(provider: SkillProviderResponse): string {
	return `${provider.kind}:${provider.id ?? provider.qualified_name}`;
}

export function skillProviderSourceName(
	provider: SkillProviderResponse,
): string {
	return provider.id ?? provider.qualified_name;
}

export function getNodeChildren(
	node: SkillTreeNodeResponse,
): SkillTreeNodeResponse[] {
	return Array.isArray(node.children) ? node.children : [];
}

export function findContainedSkills(
	root: SkillTreeNodeResponse,
): ContainedSkill[] {
	const contained: ContainedSkill[] = [];

	function visit(node: SkillTreeNodeResponse, ancestors: string[]): void {
		if (node.kind !== "directory") return;

		const relativePath = [...ancestors, node.name];
		if (node.skill) {
			contained.push({
				name: node.skill.name,
				displayName: node.skill.display_name,
				relativePath: relativePath.join("/"),
			});
		}

		for (const child of getNodeChildren(node)) {
			visit(child, relativePath);
		}
	}

	for (const child of getNodeChildren(root)) {
		visit(child, []);
	}

	return contained;
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
	const agentNames = new Map(
		allAgents.map((agent) => [agent.id, agent.display_name]),
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
				id: `${item.agent}:${location.source}:${location.provider ? skillProviderIdentity(location.provider) : "installed"}`,
				agent: item.agent,
				displayName: agentNames.get(item.agent) ?? item.agent,
				source: location.source,
				provider: location.provider,
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
			managed: data.installations.some(
				(installation) => installation.provider?.managed,
			),
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
	const managedPaths = new Set(
		items.flatMap((item) =>
			(item.locations ?? [])
				.filter((location) => location.provider?.managed)
				.map((location) => location.source_path),
		),
	);
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
								provider: undefined,
							},
						]
					: [];
		for (const location of itemLocations) {
			if (managedPaths.has(location.source_path)) continue;
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

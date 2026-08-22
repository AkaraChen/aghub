import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { useEffect, useMemo, useState } from "react";
import type {
	MarketSkill,
	McpResponse,
	PromptResponse,
	SkillResponse,
	SubAgentResponse,
} from "../generated/dto";
import { useAgentAvailability } from "./use-agent-availability";
import { useApi } from "./use-api";
import { mcpListQueryOptions } from "../requests/mcps";
import { promptListQueryOptions } from "../requests/prompts";
import { skillListQueryOptions } from "../requests/skills";
import { subAgentListQueryOptions } from "../requests/sub-agents";

export type ResourceKind =
	"agent" | "skill" | "mcp" | "sub-agent" | "prompt" | "library";

export interface SearchMatch {
	kind: ResourceKind;
	id: string;
	name: string;
	subtitle: string | null;
	agentId: string | null;
	href: string;
}

export interface SearchGroup {
	kind: ResourceKind;
	labelKey: string;
	items: SearchMatch[];
}

const LIBRARY_DEBOUNCE_MS = 250;

interface Options {
	query: string;
	perGroupLimit?: number;
	libraryLimit?: number;
}

function useDebouncedValue<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const handle = window.setTimeout(setDebounced, delay, value);
		return () => window.clearTimeout(handle);
	}, [value, delay]);
	return debounced;
}

export function useGlobalSearch({
	query,
	perGroupLimit,
	libraryLimit = 5,
}: Options) {
	const api = useApi();
	const { availableAgents } = useAgentAvailability();

	const installedAgents = useMemo(
		() =>
			availableAgents.filter((agent) => agent.availability.is_available),
		[availableAgents],
	);

	const trimmed = query.trim();

	// Defer the local resource lists until the user actually searches — this
	// hook is mounted from the sidebar on every page.
	const { data: skills = [] } = useQuery({
		...skillListQueryOptions({ api, scope: "global" }),
		enabled: trimmed.length > 0,
	});
	const { data: mcps = [] } = useQuery({
		...mcpListQueryOptions({ api, scope: "global" }),
		enabled: trimmed.length > 0,
	});
	const { data: subAgents = [] } = useQuery({
		...subAgentListQueryOptions({ api, scope: "global" }),
		enabled: trimmed.length > 0,
	});
	const { data: prompts = [] } = useQuery({
		...promptListQueryOptions({ api }),
		enabled: trimmed.length > 0,
	});
	const debouncedTrimmed = useDebouncedValue(trimmed, LIBRARY_DEBOUNCE_MS);

	const { data: marketResults = [], isFetching: isMarketFetching } = useQuery<
		MarketSkill[]
	>({
		queryKey: ["global-search", "market", debouncedTrimmed, libraryLimit],
		queryFn: () => api.market.search(debouncedTrimmed, libraryLimit),
		enabled: debouncedTrimmed.length >= 2,
		staleTime: 60_000,
	});

	const agentFuse = useMemo(
		() =>
			new Fuse(installedAgents, {
				keys: [
					{ name: "display_name", weight: 2 },
					{ name: "id", weight: 1 },
				],
				threshold: 0.4,
				ignoreLocation: true,
			}),
		[installedAgents],
	);
	const skillFuse = useMemo(
		() =>
			new Fuse(skills, {
				keys: [
					{ name: "name", weight: 2 },
					{ name: "description", weight: 1 },
				],
				threshold: 0.4,
				ignoreLocation: true,
			}),
		[skills],
	);
	const mcpFuse = useMemo(
		() =>
			new Fuse(mcps, {
				keys: ["name"],
				threshold: 0.4,
				ignoreLocation: true,
			}),
		[mcps],
	);
	const subAgentFuse = useMemo(
		() =>
			new Fuse(subAgents, {
				keys: [
					{ name: "name", weight: 2 },
					{ name: "description", weight: 1 },
				],
				threshold: 0.4,
				ignoreLocation: true,
			}),
		[subAgents],
	);
	const promptFuse = useMemo(
		() =>
			new Fuse(prompts, {
				keys: [
					{ name: "title", weight: 2 },
					{ name: "tags", weight: 1 },
					{ name: "description", weight: 1 },
					{ name: "content", weight: 0.5 },
				],
				threshold: 0.4,
				ignoreLocation: true,
			}),
		[prompts],
	);

	const groups = useMemo<SearchGroup[]>(() => {
		if (!trimmed) return [];

		const cap = (arr: { item: unknown }[]) =>
			perGroupLimit ? arr.slice(0, perGroupLimit) : arr;

		const agentMatches: SearchMatch[] = cap(agentFuse.search(trimmed)).map(
			({ item }) => {
				const agent = item as { id: string; display_name: string };
				return {
					kind: "agent",
					id: agent.id,
					name: agent.display_name,
					subtitle: agent.id,
					agentId: agent.id,
					href: `/skills?agent=${encodeURIComponent(agent.id)}`,
				};
			},
		);

		const skillMatches: SearchMatch[] = cap(skillFuse.search(trimmed)).map(
			({ item }) => {
				const skill = item as SkillResponse;
				const params = new URLSearchParams();
				if (skill.agent) params.set("agent", skill.agent);
				params.set("skill", skill.name);
				return {
					kind: "skill",
					id: `${skill.agent ?? "all"}:${skill.name}`,
					name: skill.name,
					subtitle: skill.description,
					agentId: skill.agent,
					href: `/skills?${params.toString()}`,
				};
			},
		);

		const mcpMatches: SearchMatch[] = cap(mcpFuse.search(trimmed)).map(
			({ item }) => {
				const mcp = item as McpResponse;
				const params = new URLSearchParams();
				if (mcp.agent) params.set("agent", mcp.agent);
				params.set("server", mcp.name);
				return {
					kind: "mcp",
					id: `${mcp.agent ?? "all"}:${mcp.name}`,
					name: mcp.name,
					subtitle: null,
					agentId: mcp.agent,
					href: `/mcp?${params.toString()}`,
				};
			},
		);

		const subAgentMatches: SearchMatch[] = cap(
			subAgentFuse.search(trimmed),
		).map(({ item }) => {
			const subAgent = item as SubAgentResponse;
			const params = new URLSearchParams();
			if (subAgent.agent) params.set("agent", subAgent.agent);
			const qs = params.toString();
			return {
				kind: "sub-agent",
				id: `${subAgent.agent ?? "all"}:${subAgent.name}`,
				name: subAgent.name,
				subtitle: subAgent.description,
				agentId: subAgent.agent,
				href: qs ? `/sub-agents?${qs}` : "/sub-agents",
			};
		});

		const promptMatches: SearchMatch[] = cap(
			promptFuse.search(trimmed),
		).map(({ item }) => {
			const prompt = item as PromptResponse;
			return {
				kind: "prompt",
				id: `prompt:${prompt.id}`,
				name: prompt.title,
				subtitle: prompt.description,
				agentId: null,
				href: `/prompts?prompt=${encodeURIComponent(prompt.id)}`,
			};
		});

		const libraryMatches: SearchMatch[] = marketResults.map((item) => ({
			kind: "library",
			id: `library:${item.slug}`,
			name: item.name,
			subtitle: item.author ? `by ${item.author}` : null,
			agentId: null,
			href: `/market/search?q=${encodeURIComponent(trimmed)}`,
		}));

		const out: SearchGroup[] = [];
		if (agentMatches.length > 0)
			out.push({
				kind: "agent",
				labelKey: "yourAgents",
				items: agentMatches,
			});
		if (skillMatches.length > 0)
			out.push({
				kind: "skill",
				labelKey: "skills",
				items: skillMatches,
			});
		if (mcpMatches.length > 0)
			out.push({ kind: "mcp", labelKey: "mcp", items: mcpMatches });
		if (subAgentMatches.length > 0)
			out.push({
				kind: "sub-agent",
				labelKey: "subAgents",
				items: subAgentMatches,
			});
		if (promptMatches.length > 0)
			out.push({
				kind: "prompt",
				labelKey: "prompts",
				items: promptMatches,
			});
		if (libraryMatches.length > 0)
			out.push({
				kind: "library",
				labelKey: "library",
				items: libraryMatches,
			});
		return out;
	}, [
		trimmed,
		agentFuse,
		skillFuse,
		mcpFuse,
		subAgentFuse,
		promptFuse,
		marketResults,
		perGroupLimit,
	]);

	return {
		query: trimmed,
		groups,
		isMarketFetching,
	};
}

import { PlusIcon } from "@heroicons/react/24/solid";
import { Tabs } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { AgentOverviewCard } from "../components/agent-overview-card";
import type { AgentLimitsDto, AgentUsageDto } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { agentStatus } from "../lib/agent-status";
import { cn } from "../lib/utils";
import { mcpListQueryOptions } from "../requests/mcps";
import { skillListQueryOptions } from "../requests/skills";
import {
	usageLimitsQueryOptions,
	usageSummaryQueryOptions,
} from "../requests/usage";

const USAGE_WINDOW_DAYS = 30;
type AgentFilter = "enabled" | "all";

function toCompactYmd(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}${month}${day}`;
}

export default function HomePage() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const api = useApi();
	const { availableAgents } = useAgentAvailability();
	const [agentFilter, setAgentFilter] = useState<AgentFilter>("enabled");

	const { data: skills = [] } = useQuery(
		skillListQueryOptions({ api, scope: "global" }),
	);
	const { data: mcps = [] } = useQuery(
		mcpListQueryOptions({ api, scope: "global" }),
	);

	const usageRange = useMemo(() => {
		const until = new Date();
		const since = new Date(until);
		since.setDate(since.getDate() - (USAGE_WINDOW_DAYS - 1));
		return {
			since: toCompactYmd(since),
			until: toCompactYmd(until),
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		};
	}, []);

	// Usage is best-effort: only Claude/Codex report it, and an agent that
	// isn't logged in lands in the report's `warnings` with no entry. Cards
	// without an entry simply omit the usage section.
	const { data: usageReport, isLoading: isUsageLoading } = useQuery(
		usageSummaryQueryOptions({ api, ...usageRange }),
	);
	const { data: limitsReport, isLoading: isLimitsLoading } = useQuery(
		usageLimitsQueryOptions({ api }),
	);

	// Show every agent and let agentStatus() classify it — pre-filtering by
	// is_available here would make the "missing" state unreachable on the grid.
	const readyCount = useMemo(
		() => availableAgents.filter((a) => agentStatus(a) === "ready").length,
		[availableAgents],
	);

	const visibleAgents = useMemo(() => {
		if (agentFilter === "all") return availableAgents;
		return availableAgents.filter((agent) => !agent.isDisabled);
	}, [agentFilter, availableAgents]);

	const countsByAgent = useMemo(() => {
		const map = new Map<string, { skills: number; mcps: number }>();
		for (const agent of availableAgents) {
			map.set(agent.id, {
				skills: skills.filter((s) => !s.agent || s.agent === agent.id)
					.length,
				mcps: mcps.filter((m) => !m.agent || m.agent === agent.id)
					.length,
			});
		}
		return map;
	}, [availableAgents, skills, mcps]);

	const usageByAgent = useMemo(() => {
		const map = new Map<string, AgentUsageDto>();
		for (const entry of usageReport?.agents ?? []) {
			map.set(entry.agent, entry);
		}
		return map;
	}, [usageReport]);

	const limitsByAgent = useMemo(() => {
		const map = new Map<string, AgentLimitsDto>();
		for (const entry of limitsReport?.agents ?? []) {
			map.set(entry.agent, entry);
		}
		return map;
	}, [limitsReport]);

	// Claude and Codex carry usage telemetry, so surface them first — stable,
	// regardless of whether ccusage has data yet. The rest follow by status then
	// name. Each card decides its own height (a usage section spans two grid
	// rows), so the dense grid still packs short cards into a tall card's column.
	const sortedAgents = useMemo(() => {
		const statusOrder = { ready: 0, missing: 1, disabled: 2 } as const;
		const usageRank = (id: string) =>
			id === "claude" ? 0 : id === "codex" ? 1 : 2;
		return [...visibleAgents].sort((a, b) => {
			const byUsage = usageRank(a.id) - usageRank(b.id);
			if (byUsage !== 0) return byUsage;
			const byStatus =
				statusOrder[agentStatus(a)] - statusOrder[agentStatus(b)];
			if (byStatus !== 0) return byStatus;
			return a.display_name.localeCompare(b.display_name);
		});
	}, [visibleAgents]);

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
				<header className="mb-6 flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("homeTitle")}
						</h1>
						<p className="text-sm text-muted">
							{t("homeSubtitle", {
								ready: readyCount,
								total: availableAgents.length,
							})}
						</p>
					</div>
					<Tabs
						selectedKey={agentFilter}
						onSelectionChange={(key) =>
							setAgentFilter(String(key) as AgentFilter)
						}
					>
						<Tabs.ListContainer>
							<Tabs.List
								aria-label={t("agents")}
								className="inline-flex w-auto"
							>
								<Tabs.Tab
									id="enabled"
									className="px-3 whitespace-nowrap"
								>
									{t("enabled")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab
									id="all"
									className="px-3 whitespace-nowrap"
								>
									{t("all")}
									<Tabs.Indicator />
								</Tabs.Tab>
							</Tabs.List>
						</Tabs.ListContainer>
					</Tabs>
				</header>

				<section
					aria-label={t("yourAgents")}
					className="grid grid-flow-row-dense auto-rows-[6.5rem] grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
				>
					{sortedAgents.map((agent) => {
						const counts = countsByAgent.get(agent.id);
						const hasUsage =
							agent.id === "claude" || agent.id === "codex";
						return (
							<AgentOverviewCard
								key={agent.id}
								agent={agent}
								skillCount={counts?.skills ?? 0}
								mcpCount={counts?.mcps ?? 0}
								usage={usageByAgent.get(agent.id)}
								limits={limitsByAgent.get(agent.id)}
								isUsageLoading={
									hasUsage &&
									(isUsageLoading || isLimitsLoading)
								}
							/>
						);
					})}
					<button
						type="button"
						onClick={() => setLocation("/settings?tab=agents")}
						className={cn(
							"group/add row-span-1 flex h-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-4 text-center transition-colors dark:border-foreground/15",
							"hover:border-accent hover:bg-accent/10 focus-visible:border-accent focus-visible:bg-accent/10 focus-visible:outline-none",
						)}
					>
						<PlusIcon className="size-5 text-muted transition-colors group-hover/add:text-accent group-focus-visible/add:text-accent" />
						<p className="text-sm font-medium">{t("addAgent")}</p>
					</button>
				</section>
			</div>
		</div>
	);
}

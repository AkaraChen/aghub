import { PlusIcon } from "@heroicons/react/24/solid";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
	AgentOverviewCard,
	type AgentUsageDisplay,
} from "../components/agent-overview-card";
import type { AgentLimitsDto, AgentUsageDto } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useUsageSettings } from "../hooks/use-usage-settings";
import { agentStatus } from "../lib/agent-status";
import { agentSettings, DEFAULT_USAGE_SETTINGS } from "../lib/store";
import { cn } from "../lib/utils";
import { mcpListQueryOptions } from "../requests/mcps";
import { skillListQueryOptions } from "../requests/skills";
import {
	usageLimitsQueryOptions,
	usageSummaryQueryOptions,
} from "../requests/usage";

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
	const { data: usageSettings } = useUsageSettings();
	const settings = usageSettings ?? DEFAULT_USAGE_SETTINGS;

	const { data: skills = [] } = useQuery(
		skillListQueryOptions({ api, scope: "global" }),
	);
	const { data: mcps = [] } = useQuery(
		mcpListQueryOptions({ api, scope: "global" }),
	);

	const { showUsageOnHome, windowDays } = settings.home;
	const { timezone } = settings;
	const usageRange = useMemo(() => {
		const until = new Date();
		const since = new Date(until);
		since.setDate(since.getDate() - (windowDays - 1));
		return {
			since: toCompactYmd(since),
			until: toCompactYmd(until),
			timezone:
				timezone ||
				new Intl.DateTimeFormat().resolvedOptions().timeZone,
		};
	}, [windowDays, timezone]);

	const refetchInterval =
		settings.pollIntervalMs > 0 ? settings.pollIntervalMs : false;

	// Usage is best-effort: agents without local ccusage data land in the
	// report's warnings with no entry. Cards without an entry omit the block.
	const { data: usageReport } = useQuery(
		usageSummaryQueryOptions({
			api,
			...usageRange,
			offline: settings.offlinePricing,
			config: settings.ccusageConfigPath,
			timeoutSecs: settings.requestTimeoutSecs,
			args: settings.extraArgs,
			enabled: showUsageOnHome,
			refetchInterval,
		}),
	);
	const { data: limitsReport } = useQuery(
		usageLimitsQueryOptions({
			api,
			enabled: showUsageOnHome,
			refetchInterval,
		}),
	);

	// Show every agent and let agentStatus() classify it — pre-filtering by
	// is_available here would make the "missing" state unreachable on the grid.
	const readyCount = useMemo(
		() => availableAgents.filter((a) => agentStatus(a) === "ready").length,
		[availableAgents],
	);

	// Home mirrors the Settings → Agents enablement: only usable agents
	// (installed and enabled) get a card; everything else is managed there.
	const visibleAgents = useMemo(
		() => availableAgents.filter((agent) => agent.isUsable),
		[availableAgents],
	);

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

	const usageDisplayFor = (agentId: string): AgentUsageDisplay => {
		const agent = agentSettings(settings, agentId);
		const layout = settings.home.perAgent[agentId] ?? settings.home.default;
		return {
			alertThresholdPct:
				agent.alertThresholdPct ?? settings.globalAlertThresholdPct,
			windowSlots: layout.windowSlots,
			statSlots: layout.statSlots,
		};
	};

	// Claude and Codex carry usage telemetry, so surface them first — stable,
	// regardless of whether ccusage has data yet. The rest follow by name.
	// Each card decides its own height (a usage section spans two grid rows),
	// so the dense grid still packs short cards into a tall card's column.
	const sortedAgents = useMemo(() => {
		const usageRank = (id: string) =>
			id === "claude" ? 0 : id === "codex" ? 1 : 2;
		return [...visibleAgents].sort((a, b) => {
			const byUsage = usageRank(a.id) - usageRank(b.id);
			if (byUsage !== 0) return byUsage;
			return a.display_name.localeCompare(b.display_name);
		});
	}, [visibleAgents]);

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
				<header className="mb-6 flex flex-col gap-1">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("homeTitle")}
					</h1>
					<p className="text-sm text-muted">
						{t("homeSubtitle", {
							ready: readyCount,
							total: availableAgents.length,
						})}
					</p>
				</header>

				<section
					aria-label={t("yourAgents")}
					className="grid grid-flow-row-dense auto-rows-[6.5rem] grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
				>
					{sortedAgents.map((agent) => {
						const counts = countsByAgent.get(agent.id);
						return (
							<AgentOverviewCard
								key={agent.id}
								agent={agent}
								skillCount={counts?.skills ?? 0}
								mcpCount={counts?.mcps ?? 0}
								usage={usageByAgent.get(agent.id)}
								limits={limitsByAgent.get(agent.id)}
								usageDisplay={usageDisplayFor(agent.id)}
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

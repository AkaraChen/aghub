import { Cog6ToothIcon } from "@heroicons/react/24/solid";
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
import {
	agentSettings,
	DEFAULT_USAGE_SETTINGS,
	USAGE_QUOTA_AGENTS,
} from "../lib/store";
import {
	skillTargetIds,
	UNIVERSAL_SKILL_TARGET_ID,
} from "../lib/skill-targets";
import { buildUsageDateRange } from "../lib/usage-date-range";
import { cn } from "../lib/utils";
import { mcpListQueryOptions } from "../requests/mcps";
import { skillListQueryOptions } from "../requests/skills";
import {
	usageAgentsQueryOptions,
	usageLimitsQueryOptions,
	usageSummaryQueryOptions,
} from "../requests/usage";

export default function HomePage() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const api = useApi();
	const { availableAgents } = useAgentAvailability();
	const { data: usageSettings } = useUsageSettings();
	const settings = usageSettings ?? DEFAULT_USAGE_SETTINGS;
	const usageEnabled =
		usageSettings !== undefined && settings.home.showUsageOnHome;

	const { data: skills = [] } = useQuery(
		skillListQueryOptions({ api, scope: "global" }),
	);
	const { data: mcps = [] } = useQuery(
		mcpListQueryOptions({ api, scope: "global" }),
	);

	const { windowDays } = settings.home;
	const { timezone } = settings;
	const usageRange = buildUsageDateRange(windowDays, timezone);

	const refetchInterval =
		settings.pollIntervalMs > 0 ? settings.pollIntervalMs : false;
	const usageAgentsQuery = useQuery(
		usageAgentsQueryOptions({ api, enabled: usageEnabled }),
	);
	const homeUsageAgentIds = useMemo(() => {
		const supported = new Set(usageAgentsQuery.data ?? []);
		const agentIds = availableAgents
			.filter((agent) => agent.isUsable && supported.has(agent.id))
			.map((agent) => agent.id);
		return agentIds;
	}, [availableAgents, usageAgentsQuery.data]);
	const quotaAgentIds = useMemo(() => {
		const enabledAgentIds = new Set(
			availableAgents
				.filter((agent) => agent.isUsable)
				.map((agent) => agent.id),
		);
		return USAGE_QUOTA_AGENTS.filter((id) => enabledAgentIds.has(id));
	}, [availableAgents]);

	// Usage is best-effort: agents without local ccusage data land in the
	// report's warnings with no entry. Cards without an entry omit the block.
	const { data: usageReport } = useQuery(
		usageSummaryQueryOptions({
			api,
			since: usageRange.since,
			until: usageRange.until,
			timezone: usageRange.timezone,
			offline: settings.offlinePricing,
			config: settings.ccusageConfigPath,
			timeoutSecs: settings.requestTimeoutSecs,
			args: settings.extraArgs,
			agents: homeUsageAgentIds,
			enabled: usageEnabled && usageAgentsQuery.isSuccess,
			refetchInterval,
		}),
	);
	const { data: limitsReport } = useQuery(
		usageLimitsQueryOptions({
			api,
			agents: quotaAgentIds,
			enabled: usageEnabled,
			refetchInterval,
		}),
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
				skills: skills.filter((skill) => {
					const targets = skillTargetIds(skill);
					return (
						targets.size === 0 ||
						targets.has(agent.id) ||
						(agent.capabilities.skills.universal &&
							targets.has(UNIVERSAL_SKILL_TARGET_ID))
					);
				}).length,
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

	// Claude and Codex carry quota telemetry, so surface them first — stable,
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
					<p className="text-sm text-muted">{t("homeSubtitle")}</p>
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
								usage={
									usageEnabled
										? usageByAgent.get(agent.id)
										: undefined
								}
								limits={
									usageEnabled
										? limitsByAgent.get(agent.id)
										: undefined
								}
								usageDisplay={usageDisplayFor(agent.id)}
							/>
						);
					})}
					<button
						type="button"
						onClick={() => setLocation("/settings?tab=agents")}
						className={cn(
							"group/manage row-span-1 flex h-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-4 text-center transition-colors dark:border-foreground/15",
							"hover:border-accent hover:bg-accent/10 focus-visible:border-accent focus-visible:bg-accent/10 focus-visible:outline-none",
						)}
					>
						<Cog6ToothIcon className="size-5 text-muted transition-colors group-hover/manage:text-accent group-focus-visible/manage:text-accent" />
						<p className="text-sm font-medium">
							{t("manageAgentHarnesses")}
						</p>
					</button>
				</section>
			</div>
		</div>
	);
}

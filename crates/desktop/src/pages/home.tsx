import { PlusIcon } from "@heroicons/react/24/solid";
import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { AgentOverviewCard } from "../components/agent-overview-card";
import { hasUsageContent } from "../components/agent-overview-card-helpers";
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
	const { data: usageReport } = useQuery(
		usageSummaryQueryOptions({ api, ...usageRange }),
	);
	const { data: limitsReport } = useQuery(usageLimitsQueryOptions({ api }));

	const installedAgents = useMemo(
		() =>
			availableAgents.filter((agent) => agent.availability.is_available),
		[availableAgents],
	);

	const readyCount = useMemo(
		() => installedAgents.filter((a) => agentStatus(a) === "ready").length,
		[installedAgents],
	);

	const countsByAgent = useMemo(() => {
		const map = new Map<string, { skills: number; mcps: number }>();
		for (const agent of installedAgents) {
			map.set(agent.id, {
				skills: skills.filter((s) => !s.agent || s.agent === agent.id)
					.length,
				mcps: mcps.filter((m) => !m.agent || m.agent === agent.id)
					.length,
			});
		}
		return map;
	}, [installedAgents, skills, mcps]);

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

	// Cards with a usage section sort first and span two grid rows; usage-less
	// cards span one, so a dense grid packs two short cards into the column
	// space of one tall card.
	const sortedAgents = useMemo(() => {
		const order = { ready: 0, missing: 1, disabled: 2 } as const;
		return installedAgents
			.map((agent) => ({
				agent,
				hasUsage: hasUsageContent({
					usage: usageByAgent.get(agent.id),
					limits: limitsByAgent.get(agent.id),
				}),
			}))
			.sort((a, b) => {
				if (a.hasUsage !== b.hasUsage) return a.hasUsage ? -1 : 1;
				const byStatus =
					order[agentStatus(a.agent)] - order[agentStatus(b.agent)];
				if (byStatus !== 0) return byStatus;
				return a.agent.display_name.localeCompare(b.agent.display_name);
			});
	}, [installedAgents, usageByAgent, limitsByAgent]);

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
							total: installedAgents.length,
						})}
					</p>
				</header>

				<section
					aria-label={t("yourAgents")}
					className="grid grid-flow-row-dense auto-rows-[6.25rem] grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
				>
					{sortedAgents.map(({ agent }) => {
						const counts = countsByAgent.get(agent.id);
						return (
							<AgentOverviewCard
								key={agent.id}
								agent={agent}
								skillCount={counts?.skills ?? 0}
								mcpCount={counts?.mcps ?? 0}
								usage={usageByAgent.get(agent.id)}
								limits={limitsByAgent.get(agent.id)}
							/>
						);
					})}
					<button
						type="button"
						onClick={() => setLocation("/settings?tab=agents")}
						className={cn(
							"group/add row-span-1 flex h-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-4 text-center transition-colors",
							"hover:border-accent hover:bg-accent/10 focus-visible:border-accent focus-visible:bg-accent/10 focus-visible:outline-none",
						)}
					>
						<PlusIcon className="size-5 text-muted transition-colors group-hover/add:text-accent group-focus-visible/add:text-accent" />
						<p className="text-sm font-medium">{t("addAgent")}</p>
					</button>
				</section>

				<section className="mt-8">
					<h2 className="mb-2 text-sm font-medium tracking-wider text-muted uppercase">
						{t("quickActions")}
					</h2>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							onPress={() => setLocation("/market")}
						>
							{t("browseMarket")}
						</Button>
						<Button
							variant="tertiary"
							onPress={() => setLocation("/settings?tab=agents")}
						>
							{t("manageAgents")}
						</Button>
					</div>
				</section>
			</div>
		</div>
	);
}

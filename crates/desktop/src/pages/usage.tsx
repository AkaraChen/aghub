import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { Button, Meter, Spinner, Toolbar, Tooltip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type {
	AgentLimitsDto,
	AgentUsageDto,
	UsageTotalsDto,
} from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useUsageSettings } from "../hooks/use-usage-settings";
import { AgentIcon } from "../lib/agent-icons";
import { agentSettings, DEFAULT_USAGE_SETTINGS } from "../lib/store";
import {
	clampPct,
	formatCost,
	formatTokens,
	meterColor,
	quotaWindowLabelKey,
	resetsIn,
	shortCcusageVersion,
} from "../lib/usage-format";
import { cn } from "../lib/utils";
import {
	usageLimitsQueryOptions,
	usageStatusQueryOptions,
	usageSummaryQueryOptions,
} from "../requests/usage";

/** The page shows a fixed recent window; day-level tuning lives in settings. */
const WINDOW_DAYS = 30;

/** Pretty names for report agents that aren't installed locally (agent
 *  availability carries no display_name for them). */
const FALLBACK_LABELS: Record<string, string> = {
	claude: "Claude",
	codex: "Codex",
};

/** Totals fields that hold token counts (everything but the cost). */
type TokenField = Exclude<keyof UsageTotalsDto, "cost_usd">;

/** Token breakdown rows, in report order; zero-valued rows are dropped. */
const BREAKDOWN: { field: TokenField; labelKey: string }[] = [
	{ field: "input_tokens", labelKey: "usageStatInputTokens" },
	{ field: "output_tokens", labelKey: "usageStatOutputTokens" },
	{ field: "cache_read_tokens", labelKey: "usageStatCacheRead" },
	{ field: "cache_creation_tokens", labelKey: "usageStatCacheCreation" },
	{ field: "reasoning_tokens", labelKey: "usageStatReasoning" },
];

function toCompactYmd(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}${month}${day}`;
}

/** Every "YYYY-MM-DD" in the page's window, oldest first — the report skips
 *  idle days, so the strip fills them in to keep the time axis linear. */
function windowDates(days: number): string[] {
	const out: string[] = [];
	const cursor = new Date();
	cursor.setDate(cursor.getDate() - (days - 1));
	for (let i = 0; i < days; i++) {
		out.push(
			`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
				cursor.getDate(),
			).padStart(2, "0")}`,
		);
		cursor.setDate(cursor.getDate() + 1);
	}
	return out;
}

export default function UsagePage() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const api = useApi();
	const { availableAgents } = useAgentAvailability();
	const { data: usageSettings } = useUsageSettings();
	const settings = usageSettings ?? DEFAULT_USAGE_SETTINGS;

	const range = useMemo(() => {
		const until = new Date();
		const since = new Date(until);
		since.setDate(since.getDate() - (WINDOW_DAYS - 1));
		return {
			since: toCompactYmd(since),
			until: toCompactYmd(until),
			timezone:
				settings.timezone ||
				new Intl.DateTimeFormat().resolvedOptions().timeZone,
		};
	}, [settings.timezone]);

	const { data: report, isLoading } = useQuery(
		usageSummaryQueryOptions({
			api,
			...range,
			offline: settings.offlinePricing,
			config: settings.ccusageConfigPath,
			timeoutSecs: settings.requestTimeoutSecs,
			args: settings.extraArgs,
		}),
	);
	const { data: limits } = useQuery(usageLimitsQueryOptions({ api }));
	const { data: status } = useQuery(usageStatusQueryOptions({ api }));

	const displayName = useMemo(() => {
		const byId = new Map(
			availableAgents.map((a) => [a.id, a.display_name]),
		);
		return (id: string) => byId.get(id) ?? FALLBACK_LABELS[id] ?? id;
	}, [availableAgents]);

	const limitsByAgent = useMemo(() => {
		const map = new Map<string, AgentLimitsDto>();
		for (const entry of limits?.agents ?? []) map.set(entry.agent, entry);
		return map;
	}, [limits]);

	const usableAgentIds = useMemo(
		() =>
			new Set(
				availableAgents
					.filter((agent) => agent.isUsable)
					.map((agent) => agent.id),
			),
		[availableAgents],
	);

	// Agent visibility follows Settings → Agents, the application's single
	// source of truth for installed and enabled agents.
	const agents = useMemo(
		() =>
			(report?.agents ?? []).filter((entry) =>
				usableAgentIds.has(entry.agent),
			),
		[report, usableAgentIds],
	);

	// Per-agent alert threshold with the global value as fallback — the same
	// resolution the home cards use.
	const thresholdFor = (agent: string) =>
		agentSettings(settings, agent).alertThresholdPct ??
		settings.globalAlertThresholdPct;

	// Cross-agent headline numbers; spend only when ccusage priced anything.
	const summary = useMemo(() => {
		let tokens = 0;
		let cost = 0;
		let hasCost = false;
		const dayTotals = new Map<string, number>();
		for (const entry of agents) {
			tokens += entry.totals.total_tokens;
			if (entry.totals.cost_usd != null) {
				cost += entry.totals.cost_usd;
				hasCost = true;
			}
			for (const day of entry.days) {
				dayTotals.set(
					day.date,
					(dayTotals.get(day.date) ?? 0) + day.total_tokens,
				);
			}
		}
		let activeDays = 0;
		for (const total of dayTotals.values()) if (total > 0) activeDays++;
		return { tokens, cost: hasCost ? cost : null, activeDays };
	}, [agents]);

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
				<header className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
					<div className="flex flex-col gap-1">
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("usage")}
						</h1>
						<p className="text-sm text-muted">
							{t("usageWindowDaysLabel", { days: WINDOW_DAYS })}
						</p>
					</div>
					<Toolbar
						isAttached
						aria-label={t("usage")}
						className="max-w-full rounded-lg border border-border shadow-none sm:shrink-0"
					>
						<UsageStatus
							version={status?.version ?? null}
							reachable={status?.reachable}
							updateVersion={
								status?.update_available
									? (status.latest_version ?? null)
									: null
							}
						/>
						<Tooltip delay={400}>
							<Button
								isIconOnly
								size="sm"
								variant="ghost"
								onPress={() =>
									setLocation("/settings?tab=usage")
								}
								aria-label={t("usageOpenSettings")}
								className="size-8 shrink-0 text-muted"
							>
								<Cog6ToothIcon className="size-4" />
							</Button>
							<Tooltip.Content>
								{t("usageOpenSettings")}
							</Tooltip.Content>
						</Tooltip>
					</Toolbar>
				</header>

				{isLoading ? (
					<div className="flex justify-center py-16">
						<Spinner />
					</div>
				) : status && !status.reachable ? (
					<EmptyState
						message={status.error ?? t("usageStatusUnreachable")}
						ctaLabel={t("usageOpenSettings")}
						onPress={() => setLocation("/settings?tab=usage")}
					/>
				) : agents.length === 0 ? (
					<EmptyState message={t("usageEmpty")} />
				) : (
					<div className="flex flex-col gap-6">
						<div className="flex flex-wrap items-baseline gap-x-10 gap-y-3">
							<SummaryStat
								label={t("usageStatTotalTokens")}
								value={formatTokens(summary.tokens)}
							/>
							{summary.cost != null && (
								<SummaryStat
									label={t("usageTotalSpend")}
									value={formatCost(summary.cost) ?? "—"}
								/>
							)}
							<SummaryStat
								label={t("usageActiveDays")}
								value={`${summary.activeDays} / ${WINDOW_DAYS}`}
							/>
						</div>

						<CombinedDailyBars
							agents={agents}
							nameOf={displayName}
						/>

						<section
							aria-label={t("usage")}
							className="divide-y divide-border border-y border-border"
						>
							{agents.map((entry) => (
								<AgentSummaryRow
									key={entry.agent}
									usage={entry}
									name={displayName(entry.agent)}
									limits={limitsByAgent.get(entry.agent)}
									alertThresholdPct={thresholdFor(
										entry.agent,
									)}
								/>
							))}
						</section>
					</div>
				)}
			</div>
		</div>
	);
}

function SummaryStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-2xl font-semibold tracking-tight tabular-nums">
				{value}
			</span>
			<span className="text-xs text-muted">{label}</span>
		</div>
	);
}

/** Bar height of the daily strip; segments derive px heights from this. */
const CHART_HEIGHT_PX = 96;

/** Stacked fills by report order; neutral ink first, accent tint second. */
const SERIES_FILLS = [
	"bg-foreground/30",
	"bg-accent/45",
	"bg-foreground/15",
	"bg-accent/25",
];

/** Daily totals of every agent with activity, as one stacked-bar strip —
 *  quiet monochrome + accent, no chart library. */
function CombinedDailyBars({
	agents,
	nameOf,
}: {
	agents: AgentUsageDto[];
	nameOf: (id: string) => string;
}) {
	const { t } = useTranslation();
	const series = agents
		.filter((a) => a.days.some((d) => d.total_tokens > 0))
		.slice(0, SERIES_FILLS.length);

	const dates = windowDates(WINDOW_DAYS);
	const byAgent = series.map((a) => {
		const map = new Map(a.days.map((d) => [d.date, d.total_tokens]));
		return (date: string) => map.get(date) ?? 0;
	});
	const max = Math.max(
		...dates.map((date) =>
			byAgent.reduce((sum, get) => sum + get(date), 0),
		),
		1,
	);
	const fmt = (iso: string) =>
		new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	if (series.length === 0) return null;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-end gap-4">
				{series.map((agent, index) => (
					<span
						key={agent.agent}
						className="flex items-center gap-1.5 text-[11px] text-muted"
					>
						<span
							className={cn(
								"size-2 rounded-[2px]",
								SERIES_FILLS[index],
							)}
						/>
						{nameOf(agent.agent)}
					</span>
				))}
			</div>
			<div
				role="img"
				aria-label={t("usageDailyActivity")}
				className="flex h-24 items-end gap-px"
			>
				{dates.map((date) => {
					const parts = byAgent.map((get) => get(date));
					const total = parts.reduce((a, b) => a + b, 0);
					return (
						<div
							key={date}
							title={`${fmt(date)} · ${formatTokens(total)}`}
							className="relative h-full flex-1"
						>
							<div className="absolute inset-x-0 bottom-0 flex flex-col-reverse overflow-hidden rounded-[2px]">
								{parts.map((value, index) =>
									value > 0 ? (
										<div
											key={series[index].agent}
											className={SERIES_FILLS[index]}
											style={{
												height: `${Math.max((value / max) * CHART_HEIGHT_PX, 2)}px`,
											}}
										/>
									) : null,
								)}
							</div>
							{total === 0 && (
								<div className="absolute inset-x-0 bottom-0 h-0.5 rounded-[2px] bg-foreground/8" />
							)}
						</div>
					);
				})}
			</div>
			<div className="flex justify-between text-[11px] text-muted">
				<span>{fmt(dates[0])}</span>
				<span>{fmt(dates[dates.length - 1])}</span>
			</div>
		</div>
	);
}

/** One agent as a compact row: identity + headline numbers on the left,
 *  quota meters and the token breakdown on the right. */
function AgentSummaryRow({
	usage,
	name,
	limits,
	alertThresholdPct,
}: {
	usage: AgentUsageDto;
	name: string;
	limits?: AgentLimitsDto;
	alertThresholdPct: number;
}) {
	const { t } = useTranslation();
	const { totals } = usage;
	const cost = formatCost(totals.cost_usd);
	const rows = BREAKDOWN.filter(({ field }) => totals[field] > 0);

	return (
		<div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-start sm:gap-8">
			<div className="flex w-full shrink-0 flex-col gap-2 sm:w-44">
				<div className="flex items-center gap-2">
					<AgentIcon id={usage.agent} name={name} size="xs" />
					<span className="min-w-0 truncate text-sm font-medium text-foreground">
						{name}
					</span>
				</div>
				<div className="flex flex-col gap-0.5">
					<span className="text-xl font-semibold tracking-tight tabular-nums">
						{formatTokens(totals.total_tokens)}
					</span>
					<span className="text-xs text-muted">
						{t("usageStatTotalTokens")}
						{cost && ` · ${cost}`}
					</span>
				</div>
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-3">
				{limits && limits.windows.length > 0 && (
					<div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-3">
						{limits.windows.map((quota) => {
							const pct = clampPct(quota.utilization_pct);
							const label = t(quotaWindowLabelKey(quota.kind));
							const reset = resetsIn(quota.resets_at);
							return (
								<div
									key={quota.kind}
									className="flex flex-col gap-0.5"
								>
									<div className="flex items-baseline justify-between gap-2 text-[11px]">
										<span className="truncate text-muted">
											{label}
											{reset && (
												<span
													title={t("usageResetsIn", {
														time: reset,
													})}
													className="text-foreground/40"
												>
													{" "}
													· {reset}
												</span>
											)}
										</span>
										<span className="font-medium tabular-nums">
											{Math.round(pct)}%
										</span>
									</div>
									<Meter
										aria-label={label}
										value={pct}
										color={meterColor(
											pct,
											alertThresholdPct,
										)}
										size="sm"
									>
										<Meter.Track>
											<Meter.Fill />
										</Meter.Track>
									</Meter>
								</div>
							);
						})}
					</div>
				)}
				{rows.length > 0 && (
					<dl className="flex flex-wrap gap-x-5 gap-y-1">
						{rows.map(({ field, labelKey }) => (
							<div
								key={field}
								className="flex items-baseline gap-1.5 text-[11px]"
							>
								<dt className="text-muted">{t(labelKey)}</dt>
								<dd className="tabular-nums">
									{formatTokens(totals[field])}
								</dd>
							</div>
						))}
					</dl>
				)}
			</div>
		</div>
	);
}

function UsageStatus({
	version,
	reachable,
	updateVersion,
}: {
	version: string | null;
	reachable?: boolean;
	updateVersion: string | null;
}) {
	const { t } = useTranslation();
	return (
		<div
			role="status"
			className="flex shrink-0 items-center gap-2 pl-2 text-xs"
		>
			<span
				className={cn(
					"size-2 rounded-full",
					reachable === undefined
						? "bg-muted"
						: reachable
							? "bg-success"
							: "bg-danger",
				)}
			/>
			<span className="text-muted tabular-nums">
				{reachable === undefined
					? t("usageStatusChecking")
					: version
						? shortCcusageVersion(version)
						: "ccusage"}
			</span>
			{updateVersion && (
				<span className="text-accent">
					{t("usageStatusUpdate", { version: updateVersion })}
				</span>
			)}
		</div>
	);
}

function EmptyState({
	message,
	ctaLabel,
	onPress,
}: {
	message: string;
	ctaLabel?: string;
	onPress?: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-3 py-16 text-center">
			<p className="text-sm text-muted">{message}</p>
			{ctaLabel && onPress && (
				<Button size="sm" variant="secondary" onPress={onPress}>
					{ctaLabel}
				</Button>
			)}
		</div>
	);
}

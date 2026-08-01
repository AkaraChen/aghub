import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { Button, Card, Spinner, Tooltip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { UsageDailyBars } from "../components/usage-daily-bars";
import type { AgentUsageDto, UsageTotalsDto } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import { useUsageSettings } from "../hooks/use-usage-settings";
import { AgentIcon } from "../lib/agent-icons";
import { DEFAULT_USAGE_SETTINGS } from "../lib/store";
import { USAGE_AGENT_LABELS } from "../lib/usage-agents";
import {
	formatCost,
	formatTokens,
	shortCcusageVersion,
} from "../lib/usage-format";
import { buildUsageDateRange } from "../lib/usage-date-range";
import { cn } from "../lib/utils";
import {
	usageAgentsQueryOptions,
	usageStatusQueryOptions,
	usageSummaryQueryOptions,
} from "../requests/usage";

/** The page shows a fixed recent window; day-level tuning lives in settings. */
const WINDOW_DAYS = 30;

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

export default function UsagePage() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const api = useApi();
	const { availableAgents } = useAgentAvailability();
	const usageSettingsQuery = useUsageSettings();
	const { data: usageSettings } = usageSettingsQuery;
	const settings = usageSettings ?? DEFAULT_USAGE_SETTINGS;
	const settingsReady = usageSettingsQuery.isSuccess;

	const range = buildUsageDateRange(WINDOW_DAYS, settings.timezone);
	const refetchInterval =
		settings.pollIntervalMs > 0 ? settings.pollIntervalMs : false;
	const usageAgentsQuery = useQuery(
		usageAgentsQueryOptions({ api, enabled: settingsReady }),
	);
	const enabledAgentIds = new Set(
		availableAgents
			.filter((agent) => agent.isUsable)
			.map((agent) => agent.id),
	);
	const enabledUsageAgentIds = (usageAgentsQuery.data ?? []).filter((id) =>
		enabledAgentIds.has(id),
	);

	const reportQuery = useQuery(
		usageSummaryQueryOptions({
			api,
			since: range.since,
			until: range.until,
			timezone: range.timezone,
			offline: settings.offlinePricing,
			config: settings.ccusageConfigPath,
			timeoutSecs: settings.requestTimeoutSecs,
			args: settings.extraArgs,
			agents: enabledUsageAgentIds,
			enabled: settingsReady && usageAgentsQuery.isSuccess,
			refetchInterval,
		}),
	);
	const { data: report } = reportQuery;
	const statusQuery = useQuery(usageStatusQueryOptions({ api }));
	const { data: status } = statusQuery;
	const isLoading =
		usageSettingsQuery.isPending ||
		usageAgentsQuery.isPending ||
		reportQuery.isLoading;
	const settingsError =
		usageSettingsQuery.error instanceof Error
			? usageSettingsQuery.error.message
			: t("usageSettingsLoadError");
	const reportError =
		usageAgentsQuery.error instanceof Error
			? usageAgentsQuery.error.message
			: reportQuery.error instanceof Error
				? reportQuery.error.message
				: t("usageReportLoadError");
	const emptyMessage =
		enabledUsageAgentIds.length === 0
			? t("usageNoEnabledAgents")
			: (report?.warnings[0] ?? t("usageEmpty"));

	const displayName = useMemo(() => {
		const byId = new Map(
			availableAgents.map((a) => [a.id, a.display_name]),
		);
		return (id: string) => byId.get(id) ?? USAGE_AGENT_LABELS[id] ?? id;
	}, [availableAgents]);

	const agents = useMemo(() => report?.agents ?? [], [report]);

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
					<div className="flex max-w-full items-center gap-1 sm:shrink-0">
						<UsageStatus
							version={status?.version ?? null}
							reachable={
								status?.reachable ??
								(statusQuery.isError ? false : undefined)
							}
							isPending={statusQuery.isPending}
							error={
								status?.error ??
								(statusQuery.error instanceof Error
									? statusQuery.error.message
									: undefined)
							}
							latestVersion={
								status?.update_available
									? status.latest_version
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
					</div>
				</header>

				{isLoading ? (
					<div className="flex justify-center py-16">
						<Spinner />
					</div>
				) : usageSettingsQuery.isError ? (
					<EmptyState message={settingsError} />
				) : statusQuery.isError || status?.reachable === false ? (
					<EmptyState
						message={
							status?.error ??
							(statusQuery.error instanceof Error
								? statusQuery.error.message
								: t("usageStatusUnreachable"))
						}
						ctaLabel={t("usageOpenSettings")}
						onPress={() => setLocation("/settings?tab=usage")}
					/>
				) : usageAgentsQuery.isError || reportQuery.isError ? (
					<EmptyState message={reportError} />
				) : agents.length === 0 ? (
					<EmptyState message={emptyMessage} />
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

						<UsageDailyBars
							agents={agents}
							dates={range.dates}
							nameOf={displayName}
						/>

						<section
							aria-label={t("usage")}
							className="flex flex-col gap-3"
						>
							{agents.map((entry) => (
								<AgentSummaryRow
									key={entry.agent}
									usage={entry}
									name={displayName(entry.agent)}
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

/** One agent as a compact row: identity + headline numbers on the left and
 *  the token breakdown on the right. */
function AgentSummaryRow({
	usage,
	name,
}: {
	usage: AgentUsageDto;
	name: string;
}) {
	const { t } = useTranslation();
	const { totals } = usage;
	const cost = formatCost(totals.cost_usd);
	const rows = BREAKDOWN.filter(({ field }) => totals[field] > 0);

	return (
		<Card
			data-testid="usage-agent-card"
			className="gap-0 border border-transparent p-5 transition-colors duration-[var(--dur-fast)] hover:border-border motion-reduce:transition-none"
		>
			<Card.Content className="flex flex-col gap-4 p-0 sm:flex-row sm:items-start sm:gap-8">
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

				<div className="min-w-0 flex-1">
					{rows.length > 0 && (
						<dl className="flex flex-wrap gap-x-5 gap-y-1">
							{rows.map(({ field, labelKey }) => (
								<div
									key={field}
									className="flex items-baseline gap-1.5 text-[11px]"
								>
									<dt className="text-muted">
										{t(labelKey)}
									</dt>
									<dd className="tabular-nums">
										{formatTokens(totals[field])}
									</dd>
								</div>
							))}
						</dl>
					)}
				</div>
			</Card.Content>
		</Card>
	);
}

function UsageStatus({
	version,
	reachable,
	isPending,
	error,
	latestVersion,
}: {
	version: string | null;
	reachable?: boolean;
	isPending: boolean;
	error?: string | null;
	latestVersion?: string | null;
}) {
	const { t } = useTranslation();
	return (
		<div
			role="status"
			className="flex shrink-0 items-center gap-2 text-xs"
			title={error ?? undefined}
		>
			<span
				aria-hidden
				className={cn(
					"size-2 rounded-full",
					isPending
						? "bg-muted"
						: reachable
							? "bg-success"
							: "bg-danger",
				)}
			/>
			<span className="text-muted tabular-nums">
				{isPending
					? t("usageStatusChecking")
					: reachable === false
						? t("usageStatusUnreachable")
						: version
							? shortCcusageVersion(version)
							: "ccusage"}
			</span>
			{latestVersion && (
				<>
					<span aria-hidden className="text-muted">
						·
					</span>
					<span className="shrink-0 text-accent tabular-nums">
						{t("usageStatusUpdate", {
							version: shortCcusageVersion(latestVersion),
						})}
					</span>
				</>
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

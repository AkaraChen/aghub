import { Meter, Spinner } from "@heroui/react";
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
import { DEFAULT_USAGE_SETTINGS } from "../lib/store";
import {
	clampPct,
	formatCost,
	formatTokens,
	meterColor,
	quotaWindowLabelKey,
} from "../lib/usage-format";
import { cn } from "../lib/utils";
import {
	usageLimitsQueryOptions,
	usageStatusQueryOptions,
	usageSummaryQueryOptions,
} from "../requests/usage";

/** The page shows a fixed recent window; day-level tuning lives in settings. */
const WINDOW_DAYS = 30;

/** Token breakdown rows, in report order; zero-valued rows are dropped. */
const BREAKDOWN: { field: keyof UsageTotalsDto; labelKey: string }[] = [
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
		return (id: string) => byId.get(id) ?? id;
	}, [availableAgents]);

	const limitsByAgent = useMemo(() => {
		const map = new Map<string, AgentLimitsDto>();
		for (const entry of limits?.agents ?? []) map.set(entry.agent, entry);
		return map;
	}, [limits]);

	const agents = report?.agents ?? [];

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
				<header className="mb-6 flex items-start justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("usage")}
						</h1>
						<p className="text-sm text-muted">
							{t("usageWindowDaysLabel", { days: WINDOW_DAYS })}
						</p>
					</div>
					<StatusChip
						version={status?.version ?? null}
						reachable={status?.reachable}
						updateVersion={
							status?.update_available
								? (status.latest_version ?? null)
								: null
						}
						onPress={() => setLocation("/settings?tab=usage")}
					/>
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
					<section
						aria-label={t("usage")}
						className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
					>
						{agents.map((entry) => (
							<UsageAgentCard
								key={entry.agent}
								usage={entry}
								name={displayName(entry.agent)}
								limits={limitsByAgent.get(entry.agent)}
								alertThresholdPct={
									settings.globalAlertThresholdPct
								}
							/>
						))}
					</section>
				)}
			</div>
		</div>
	);
}

function UsageAgentCard({
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
	const rows = BREAKDOWN.filter(({ field }) => (totals[field] as number) > 0);

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
			<div className="flex items-center gap-2">
				<AgentIcon id={usage.agent} name={name} size="xs" />
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
					{name}
				</span>
				{cost && (
					<span className="shrink-0 text-sm font-medium tabular-nums">
						{cost}
					</span>
				)}
			</div>

			<div className="flex items-baseline gap-1.5">
				<span className="text-xl font-semibold tabular-nums">
					{formatTokens(totals.total_tokens)}
				</span>
				<span className="text-xs text-muted">
					{t("usageStatTotalTokens")}
				</span>
			</div>

			{limits && limits.windows.length > 0 && (
				<div className="flex flex-col gap-1.5 border-t border-border pt-3">
					{limits.windows.map((quota) => {
						const pct = clampPct(quota.utilization_pct);
						const label = t(quotaWindowLabelKey(quota.kind));
						return (
							<div
								key={quota.kind}
								className="flex flex-col gap-0.5"
							>
								<div className="flex items-baseline justify-between text-[11px]">
									<span className="text-muted">{label}</span>
									<span className="font-medium tabular-nums">
										{Math.round(pct)}%
									</span>
								</div>
								<Meter
									aria-label={label}
									value={pct}
									color={meterColor(pct, alertThresholdPct)}
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
				<dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-3">
					{rows.map(({ field, labelKey }) => (
						<div
							key={field}
							className="flex items-baseline justify-between gap-1 text-[11px]"
						>
							<dt className="text-muted">{t(labelKey)}</dt>
							<dd className="tabular-nums">
								{formatTokens(totals[field] as number)}
							</dd>
						</div>
					))}
				</dl>
			)}
		</div>
	);
}

function StatusChip({
	version,
	reachable,
	updateVersion,
	onPress,
}: {
	version: string | null;
	reachable?: boolean;
	updateVersion: string | null;
	onPress: () => void;
}) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onPress}
			className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs transition-colors hover:bg-foreground/[0.04]"
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
				{version ?? "ccusage"}
			</span>
			{updateVersion && (
				<span className="text-accent">
					{t("usageStatusUpdate", { version: updateVersion })}
				</span>
			)}
		</button>
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
		<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
			<p className="text-sm text-muted">{message}</p>
			{ctaLabel && onPress && (
				<button
					type="button"
					onClick={onPress}
					className="text-sm font-medium text-accent transition-colors hover:text-accent/80"
				>
					{ctaLabel}
				</button>
			)}
		</div>
	);
}

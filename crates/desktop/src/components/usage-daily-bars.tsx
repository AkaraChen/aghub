import type { AgentUsageDto } from "../generated/dto";
import { formatTokens } from "../lib/usage-format";
import { cn } from "../lib/utils";
import { useTranslation } from "react-i18next";

const CHART_HEIGHT_PX = 96;
const SERIES_FILLS = [
	"bg-foreground/30",
	"bg-accent/45",
	"bg-foreground/15",
	"bg-accent/25",
];

interface DailySeries {
	id: string;
	label: string;
	values: ReadonlyMap<string, number>;
}

export function UsageDailyBars({
	agents,
	dates,
	nameOf,
}: {
	agents: AgentUsageDto[];
	dates: string[];
	nameOf: (id: string) => string;
}) {
	const { t } = useTranslation();
	const activeSeries = agents
		.filter((agent) => agent.days.some((day) => day.total_tokens > 0))
		.map((agent) => ({
			id: agent.agent,
			label: nameOf(agent.agent),
			values: new Map(
				agent.days.map((day) => [day.date, day.total_tokens]),
			),
		}));
	const series =
		activeSeries.length <= SERIES_FILLS.length
			? activeSeries
			: [
					...activeSeries.slice(0, SERIES_FILLS.length - 1),
					{
						id: "other",
						label: t("usageOtherAgents"),
						values: mergeDailyValues(
							activeSeries.slice(SERIES_FILLS.length - 1),
						),
					},
				];
	if (series.length === 0) return null;

	const max = Math.max(
		...dates.map((date) =>
			series.reduce((sum, item) => sum + (item.values.get(date) ?? 0), 0),
		),
		1,
	);

	return (
		<div className="flex flex-col gap-2">
			<div
				data-testid="usage-chart-legend"
				className="flex w-fit self-end items-center gap-4 rounded-lg px-2 py-1 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-surface motion-reduce:transition-none"
			>
				{series.map((item, index) => (
					<span
						key={item.id}
						className="flex items-center gap-1.5 text-[11px] text-muted"
					>
						<span
							className={cn(
								"size-2 rounded-[2px]",
								SERIES_FILLS[index],
							)}
						/>
						{item.label}
					</span>
				))}
			</div>
			<div
				role="img"
				aria-label={t("usageDailyActivity")}
				className="flex h-24 items-end gap-px"
			>
				{dates.map((date) => {
					const parts = series.map(
						(item) => item.values.get(date) ?? 0,
					);
					const total = parts.reduce((sum, value) => sum + value, 0);
					return (
						<div
							key={date}
							title={`${formatUsageDate(date)} · ${formatTokens(total)}`}
							className="relative h-full flex-1"
						>
							<div className="absolute inset-x-0 bottom-0 flex flex-col-reverse overflow-hidden rounded-[2px]">
								{parts.map((value, index) =>
									value > 0 ? (
										<div
											key={series[index].id}
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
				<span>{formatUsageDate(dates[0])}</span>
				<span>{formatUsageDate(dates[dates.length - 1])}</span>
			</div>
		</div>
	);
}

function mergeDailyValues(series: DailySeries[]): Map<string, number> {
	const totals = new Map<string, number>();
	for (const item of series) {
		for (const [date, value] of item.values) {
			totals.set(date, (totals.get(date) ?? 0) + value);
		}
	}
	return totals;
}

function formatUsageDate(iso: string): string {
	return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

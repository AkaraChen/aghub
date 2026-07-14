import type {
	AgentLimitsDto,
	AgentUsageDto,
	LimitWindowDto,
	UsageTotalsDto,
} from "../generated/dto";
import type { HomeStatId, HomeWindowId } from "../lib/store/usage";
import { clampPct, formatCost, formatTokens } from "../lib/usage-format";
import { HOME_STAT_DEFINITIONS } from "../lib/usage-home-fields";

export interface StatCell {
	id: HomeStatId;
	labelKey: string;
	/** Formatted value, or "—" when this agent reports nothing for it. */
	value: string;
	hasData: boolean;
}

export interface UsageView {
	/** Quota bars for slotted windows that have data, in slot order. */
	windows: LimitWindowDto[];
	/** Aligned to the stat slots; `null` is an empty slot kept in place. */
	statCells: (StatCell | null)[];
	/** Whether any slotted stat has real data (else the grid stays hidden). */
	hasStatData: boolean;
}

const EMPTY_VALUE = "—";

/**
 * Resolves what a card renders from the backend reports and the user's fixed
 * slot layout. Windows come out in slot order, filtered to those this agent
 * actually reports. Stats stay aligned to their slots (`null` = empty slot); a
 * slotted stat the agent doesn't report shows "—" rather than shifting position.
 */
export function buildUsage({
	usage,
	limits,
	statSlots,
	windowSlots,
}: {
	usage?: AgentUsageDto;
	limits?: AgentLimitsDto;
	statSlots: (HomeStatId | null)[];
	windowSlots: (HomeWindowId | null)[];
}): UsageView {
	const byKind = new Map<string, LimitWindowDto>(
		(limits?.windows ?? []).map((w) => [w.kind, w]),
	);

	const windows = windowSlots
		.filter((id): id is HomeWindowId => id != null)
		.map((id) => byKind.get(id))
		.filter((w): w is LimitWindowDto => w != null);

	const statCells = statSlots.map((id) =>
		id == null ? null : statCell(id, usage?.totals, byKind),
	);
	const hasStatData = statCells.some((c) => c?.hasData);

	return { windows, statCells, hasStatData };
}

function statCell(
	id: HomeStatId,
	totals: UsageTotalsDto | undefined,
	byKind: Map<string, LimitWindowDto>,
): StatCell {
	const def = HOME_STAT_DEFINITIONS[id];
	const { source } = def;
	const cell = (value: string, hasData: boolean): StatCell => ({
		id,
		labelKey: def.labelKey,
		value,
		hasData,
	});
	if (source.from === "window") {
		const window = byKind.get(source.window);
		return window
			? cell(`${Math.round(clampPct(window.utilization_pct))}%`, true)
			: cell(EMPTY_VALUE, false);
	}
	if (!totals) return cell(EMPTY_VALUE, false);
	const raw = totals[source.field];
	if (source.fmt === "cost") {
		const formatted = formatCost(raw as number | null);
		return formatted == null
			? cell(EMPTY_VALUE, false)
			: cell(formatted, true);
	}
	const tokens = raw as number;
	return tokens > 0
		? cell(formatTokens(tokens), true)
		: cell(EMPTY_VALUE, false);
}

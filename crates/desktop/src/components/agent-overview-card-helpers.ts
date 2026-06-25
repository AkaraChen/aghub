import type {
	AgentLimitsDto,
	AgentUsageDto,
	LimitWindowDto,
} from "../generated/dto";
import { formatCost, formatTokens } from "../lib/usage-format";

export interface UsageView {
	tokens: string | null;
	cost: string | null;
	windows: LimitWindowDto[];
	primaryWindow: LimitWindowDto | null;
}

/**
 * Resolves what a card renders for usage from the backend reports. Keeps the
 * windows sorted by utilization so the busiest one shows inline.
 */
export function buildUsage({
	usage,
	limits,
}: {
	usage?: AgentUsageDto;
	limits?: AgentLimitsDto;
}): UsageView {
	const windows = [...(limits?.windows ?? [])].sort(
		(a, b) => b.utilization_pct - a.utilization_pct,
	);
	return {
		tokens: usage ? formatTokens(usage.totals.total_tokens) : null,
		cost: usage ? formatCost(usage.totals.cost_usd) : null,
		windows,
		primaryWindow: windows[0] ?? null,
	};
}

/** Whether a card will render a usage section — drives sort order and row span. */
export function hasUsageContent(args: {
	usage?: AgentUsageDto;
	limits?: AgentLimitsDto;
}): boolean {
	const view = buildUsage(args);
	return view.primaryWindow != null || view.tokens != null;
}

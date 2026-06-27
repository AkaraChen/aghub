import type {
	AgentLimitsDto,
	AgentUsageDto,
	LimitWindowDto,
} from "../generated/dto";
import { formatCost, formatTokens } from "../lib/usage-format";

export interface UsageView {
	tokens: string | null;
	cost: string | null;
	input: string | null;
	output: string | null;
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
	// Drop the Sonnet weekly window: it's a separate quota most users never
	// touch (sits at 0% with no reset) and just pushes the card past its row.
	const windows = (limits?.windows ?? [])
		.filter((window) => window.kind !== "weekly_sonnet")
		.sort((a, b) => b.utilization_pct - a.utilization_pct);
	return {
		tokens: usage ? formatTokens(usage.totals.total_tokens) : null,
		cost: usage ? formatCost(usage.totals.cost_usd) : null,
		input: usage ? formatTokens(usage.totals.input_tokens) : null,
		output: usage ? formatTokens(usage.totals.output_tokens) : null,
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

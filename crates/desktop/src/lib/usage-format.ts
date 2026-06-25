import type { LimitWindowKind } from "../generated/dto";

const tokenFormatter = new Intl.NumberFormat(undefined, {
	notation: "compact",
	maximumFractionDigits: 1,
});

const costFormatter = new Intl.NumberFormat(undefined, {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

/** Compact token count, e.g. `45.2K` / `1.2M`. */
export function formatTokens(count: number): string {
	return tokenFormatter.format(count);
}

/** Formatted USD cost, or `null` when the backend reports no priced cost. */
export function formatCost(usd: number | null | undefined): string | null {
	if (usd == null) return null;
	return costFormatter.format(usd);
}

/** Quota fill color by how much of the window is consumed. */
export function meterColor(
	utilizationPct: number,
): "success" | "warning" | "danger" {
	if (utilizationPct >= 90) return "danger";
	if (utilizationPct >= 70) return "warning";
	return "success";
}

/** Clamp a utilization percentage into the meter's 0–100 range. */
export function clampPct(value: number): number {
	return Math.max(0, Math.min(100, value));
}

/** i18n key for a rate-limit window label. */
export function quotaWindowLabelKey(kind: LimitWindowKind): string {
	switch (kind) {
		case "5h":
			return "usageWindow5h";
		case "weekly":
			return "usageWindowWeekly";
		case "weekly_opus":
			return "usageWindowWeeklyOpus";
		case "weekly_sonnet":
			return "usageWindowWeeklySonnet";
		default:
			return "usageWindowOther";
	}
}

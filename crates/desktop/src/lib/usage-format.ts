import i18n from "i18next";
import type { LimitWindowKind } from "../generated/dto";

/** Compact token count in the active UI locale, e.g. `6.7B` / `66.5亿`. */
export function formatTokens(count: number): string {
	return new Intl.NumberFormat(i18n.language, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(count);
}

/** Formatted USD cost in the active UI locale, or `null` when unpriced. */
export function formatCost(usd: number | null | undefined): string | null {
	if (usd == null) return null;
	// Cents are noise once the spend reaches the hundreds; show whole dollars.
	const digits = usd >= 100 ? 0 : 2;
	return new Intl.NumberFormat(i18n.language, {
		style: "currency",
		currency: "USD",
		currencyDisplay: "narrowSymbol",
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(usd);
}

/**
 * Quota fill color by how much of the window is consumed. The configured alert
 * threshold is the `danger` line; `warning` covers the band just below it.
 */
export function meterColor(
	utilizationPct: number,
	alertThresholdPct = 90,
): "success" | "warning" | "danger" {
	if (utilizationPct >= alertThresholdPct) return "danger";
	if (utilizationPct >= Math.max(0, alertThresholdPct - 20)) return "warning";
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

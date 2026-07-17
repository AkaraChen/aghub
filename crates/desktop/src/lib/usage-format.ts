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

/** "ccusage 20.0.6" / "20.0.17" → "v20.0.6" / "v20.0.17" — the ccusage name
 *  is already carried by the surrounding UI. */
export function shortCcusageVersion(version: string): string {
	return `v${version.replace(/^ccusage\s+/, "").replace(/^v/, "")}`;
}

/**
 * Compact time until an ISO reset instant: `"18m"`, `"2h"`, `"4d"`.
 * `null` when the instant is missing or already past.
 */
export function resetsIn(iso: string | null): string | null {
	if (!iso) return null;
	const ms = new Date(iso).getTime() - Date.now();
	if (!Number.isFinite(ms) || ms <= 0) return null;
	const hours = ms / 3_600_000;
	if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
	if (hours < 48) return `${Math.round(hours)}h`;
	return `${Math.round(hours / 24)}d`;
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

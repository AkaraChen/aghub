import type { UsageTotalsDto } from "../generated/dto";
import type { HomeStatId, HomeWindowId } from "./store/usage";

/** Where a stat's value comes from and how it is formatted. */
export type HomeStatSource =
	| { from: "totals"; field: keyof UsageTotalsDto; fmt: "tokens" | "cost" }
	| { from: "window"; window: HomeWindowId; fmt: "pct" };

export interface HomeStatDefinition {
	id: HomeStatId;
	labelKey: string;
	source: HomeStatSource;
}

/**
 * Single source of truth for what each card stat reads and how it formats — the
 * card resolves a value + picks a formatter from here, no scattered switches.
 */
export const HOME_STAT_DEFINITIONS: Record<HomeStatId, HomeStatDefinition> = {
	totalTokens: {
		id: "totalTokens",
		labelKey: "usageStatTotalTokens",
		source: { from: "totals", field: "total_tokens", fmt: "tokens" },
	},
	cost: {
		id: "cost",
		labelKey: "usageStatCost",
		source: { from: "totals", field: "cost_usd", fmt: "cost" },
	},
	inputTokens: {
		id: "inputTokens",
		labelKey: "usageStatInputTokens",
		source: { from: "totals", field: "input_tokens", fmt: "tokens" },
	},
	outputTokens: {
		id: "outputTokens",
		labelKey: "usageStatOutputTokens",
		source: { from: "totals", field: "output_tokens", fmt: "tokens" },
	},
	cacheRead: {
		id: "cacheRead",
		labelKey: "usageStatCacheRead",
		source: { from: "totals", field: "cache_read_tokens", fmt: "tokens" },
	},
	cacheCreation: {
		id: "cacheCreation",
		labelKey: "usageStatCacheCreation",
		source: {
			from: "totals",
			field: "cache_creation_tokens",
			fmt: "tokens",
		},
	},
	reasoning: {
		id: "reasoning",
		labelKey: "usageStatReasoning",
		source: { from: "totals", field: "reasoning_tokens", fmt: "tokens" },
	},
	utilization5h: {
		id: "utilization5h",
		labelKey: "usageStatUtil5h",
		source: { from: "window", window: "5h", fmt: "pct" },
	},
	utilizationWeekly: {
		id: "utilizationWeekly",
		labelKey: "usageStatUtilWeekly",
		source: { from: "window", window: "weekly", fmt: "pct" },
	},
	utilizationOpus: {
		id: "utilizationOpus",
		labelKey: "usageStatUtilOpus",
		source: { from: "window", window: "weekly_opus", fmt: "pct" },
	},
};

/** Window id → label key. Reuses the existing quota window label keys. */
export const HOME_WINDOW_LABEL_KEYS: Record<HomeWindowId, string> = {
	"5h": "usageWindow5h",
	weekly: "usageWindowWeekly",
	weekly_opus: "usageWindowWeeklyOpus",
};

/**
 * Stats/windows that only one agent reports — drives the muted hint in
 * settings. The card itself skips structurally-absent values (§ card), so this
 * is settings-UI sugar, not a render gate.
 */
export const HOME_STAT_AGENT_HINT: Partial<
	Record<HomeStatId, "claude" | "codex">
> = {
	cacheCreation: "claude",
	reasoning: "codex",
	utilizationOpus: "claude",
};

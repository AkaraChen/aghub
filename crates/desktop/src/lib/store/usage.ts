import { getStore } from ".";

/**
 * ccusage usage monitoring covers only Claude and Codex — the backend
 * `UsageAgent` enum is closed (see `crates/usage/src/dto.rs`), so per-agent
 * settings are limited to this set.
 */
export type UsageTrackedAgent = "claude" | "codex";

export const USAGE_TRACKED_AGENTS: UsageTrackedAgent[] = ["claude", "codex"];

export interface UsageAgentSettings {
	/** Whether the usage dashboard polls and shows this agent. */
	tracked: boolean;
	/**
	 * Per-agent alert threshold, percent of a rate-limit window (0–100).
	 * `null` falls back to {@link UsageSettings.globalAlertThresholdPct}.
	 */
	alertThresholdPct: number | null;
}

/**
 * Bottom-stat metrics a home card can show. The first seven map to
 * `UsageTotalsDto` fields; the `utilization*` ids read from the agent's
 * rate-limit windows by kind.
 */
export const HOME_STAT_IDS = [
	"totalTokens",
	"cost",
	"inputTokens",
	"outputTokens",
	"cacheRead",
	"cacheCreation",
	"reasoning",
	"utilization5h",
	"utilizationWeekly",
	"utilizationOpus",
] as const;
export type HomeStatId = (typeof HOME_STAT_IDS)[number];

/**
 * Rate-limit windows the card renders as bars. A strict subset of
 * `LimitWindowKind` minus `weekly_sonnet`, which the backend omits for nearly
 * everyone and the card has always filtered out.
 */
export const HOME_WINDOW_IDS = ["5h", "weekly", "weekly_opus"] as const;
export type HomeWindowId = (typeof HOME_WINDOW_IDS)[number];

/** Fixed bar slots on the card (a vertical stack). */
export const CARD_WINDOW_SLOTS = 3;
/** Fixed stat slots on the card (a 2×2 corner grid). */
export const CARD_STAT_SLOTS = 4;

/** How the usage block on the home agent cards is rendered. */
export interface UsageHomeSettings {
	/** Master switch for the usage block on home cards. */
	showUsageOnHome: boolean;
	/** Rolling window (days) for the summary query that feeds the home cards. */
	windowDays: number;
	/**
	 * Fixed bar slots; array index is the slot, `null` an empty slot kept in
	 * place. Length {@link CARD_WINDOW_SLOTS}. Fields not in a slot are the
	 * palette (derived, not stored).
	 */
	windowSlots: (HomeWindowId | null)[];
	/** Fixed stat slots (2×2); `null` = empty. Length {@link CARD_STAT_SLOTS}. */
	statSlots: (HomeStatId | null)[];
}

export interface UsageSettings {
	sidecar: {
		/**
		 * `true` lets the desktop shell resolve ccusage itself (bundled
		 * sidecar, then PATH). `false` uses {@link binPath}. Read by the Rust
		 * shell at startup — see `commands/server.rs::resolve_ccusage_bin`.
		 */
		autoDiscover: boolean;
		/** Absolute path to a ccusage binary; used only when not auto-discovering. */
		binPath: string;
	};
	/** Usage dashboard poll interval in ms; `0` disables polling. */
	pollIntervalMs: number;
	/** IANA timezone for daily usage buckets; empty uses the system timezone. */
	timezone: string;
	/** ccusage pricing source: `true` = cached (`--offline`), `false` = live. */
	offlinePricing: boolean;
	/** Optional ccusage config file path (`--config`); empty = none. */
	ccusageConfigPath: string;
	/** ccusage request timeout, in seconds. */
	requestTimeoutSecs: number;
	/** Global alert threshold, percent of a rate-limit window (0–100). */
	globalAlertThresholdPct: number;
	agents: Record<UsageTrackedAgent, UsageAgentSettings>;
	home: UsageHomeSettings;
}

const USAGE_SETTINGS_KEY = "usageSettings";

/** Default bar slots — the three windows in order. */
export const DEFAULT_WINDOW_SLOTS: (HomeWindowId | null)[] = [
	"5h",
	"weekly",
	"weekly_opus",
];

/** Default stat slots — tokens/cost/input/output fill the 2×2 corners. */
export const DEFAULT_STAT_SLOTS: (HomeStatId | null)[] = [
	"totalTokens",
	"cost",
	"inputTokens",
	"outputTokens",
];

export const DEFAULT_USAGE_SETTINGS: UsageSettings = {
	sidecar: { autoDiscover: true, binPath: "" },
	pollIntervalMs: 60_000,
	timezone: "",
	offlinePricing: true,
	ccusageConfigPath: "",
	requestTimeoutSecs: 30,
	globalAlertThresholdPct: 80,
	agents: {
		claude: { tracked: true, alertThresholdPct: null },
		codex: { tracked: true, alertThresholdPct: null },
	},
	home: {
		showUsageOnHome: true,
		windowDays: 30,
		windowSlots: DEFAULT_WINDOW_SLOTS,
		statSlots: DEFAULT_STAT_SLOTS,
	},
};

/** Poll-interval presets in ms; `0` disables polling. */
export const USAGE_POLL_INTERVALS_MS = [
	0, 30_000, 60_000, 300_000, 900_000,
] as const;

/** Alert-threshold presets, percent of a rate-limit window. */
export const USAGE_ALERT_THRESHOLDS_PCT = [
	50, 60, 70, 75, 80, 85, 90, 95,
] as const;

/** Rolling-window presets (days) for the home summary query. */
export const USAGE_WINDOW_DAYS_OPTIONS = [7, 14, 30, 90] as const;

/** ccusage request-timeout presets, in seconds. */
export const USAGE_TIMEOUT_SECS_OPTIONS = [15, 30, 60, 120, 300] as const;

function clampPct(value: number): number {
	if (!Number.isFinite(value))
		return DEFAULT_USAGE_SETTINGS.globalAlertThresholdPct;
	return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeAgent(
	raw: unknown,
	fallback: UsageAgentSettings,
): UsageAgentSettings {
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	const threshold = r.alertThresholdPct;
	return {
		tracked: typeof r.tracked === "boolean" ? r.tracked : fallback.tracked,
		alertThresholdPct:
			typeof threshold === "number" && Number.isFinite(threshold)
				? clampPct(threshold)
				: null,
	};
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

const HOME_STAT_ID_SET = new Set<HomeStatId>(HOME_STAT_IDS);
const HOME_WINDOW_ID_SET = new Set<HomeWindowId>(HOME_WINDOW_IDS);

/**
 * Coerce a stored slot list to a fixed-length `(id | null)[]`: keep known ids in
 * place, collapse dupes/unknowns to `null` (position preserved), pad/truncate to
 * `length`. Array index IS the card slot.
 */
function normalizeSlots<Id extends string>(
	raw: unknown,
	idSet: ReadonlySet<Id>,
	length: number,
): (Id | null)[] {
	const out: (Id | null)[] = [];
	const seen = new Set<Id>();
	for (const v of Array.isArray(raw) ? raw : []) {
		if (out.length >= length) break;
		if (typeof v === "string" && idSet.has(v as Id) && !seen.has(v as Id)) {
			out.push(v as Id);
			seen.add(v as Id);
		} else {
			out.push(null);
		}
	}
	while (out.length < length) out.push(null);
	return out;
}

/**
 * Migrate the legacy `{ id, visible }[]` shape: visible ids in order fill the
 * leading slots; the rest fall to the palette. `null` if `raw` isn't that shape.
 */
function slotsFromLegacy<Id extends string>(
	raw: unknown,
	idSet: ReadonlySet<Id>,
	length: number,
): (Id | null)[] | null {
	if (!Array.isArray(raw)) return null;
	const visible = raw
		.filter(
			(x) =>
				typeof x === "object" &&
				x !== null &&
				idSet.has((x as { id?: unknown }).id as Id) &&
				(x as { visible?: unknown }).visible !== false,
		)
		.map((x) => (x as { id: Id }).id);
	return normalizeSlots(visible, idSet, length);
}

function normalizeHome(raw: unknown): UsageHomeSettings {
	const d = DEFAULT_USAGE_SETTINGS.home;
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	return {
		showUsageOnHome: normalizeBool(r.showUsageOnHome, d.showUsageOnHome),
		windowDays:
			typeof r.windowDays === "number" && r.windowDays > 0
				? Math.round(r.windowDays)
				: d.windowDays,
		windowSlots:
			r.windowSlots !== undefined
				? normalizeSlots(
						r.windowSlots,
						HOME_WINDOW_ID_SET,
						CARD_WINDOW_SLOTS,
					)
				: (slotsFromLegacy(
						r.windows,
						HOME_WINDOW_ID_SET,
						CARD_WINDOW_SLOTS,
					) ?? [...d.windowSlots]),
		statSlots:
			r.statSlots !== undefined
				? normalizeSlots(r.statSlots, HOME_STAT_ID_SET, CARD_STAT_SLOTS)
				: (slotsFromLegacy(
						r.stats,
						HOME_STAT_ID_SET,
						CARD_STAT_SLOTS,
					) ?? [...d.statSlots]),
	};
}

/**
 * Merge a stored (possibly partial or legacy) value onto the defaults so the
 * panel and the Rust reader always see a complete, well-typed shape.
 */
function normalizeUsageSettings(raw: unknown): UsageSettings {
	const d = DEFAULT_USAGE_SETTINGS;
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	const sidecar = (
		typeof r.sidecar === "object" && r.sidecar !== null ? r.sidecar : {}
	) as Record<string, unknown>;
	const agents = (
		typeof r.agents === "object" && r.agents !== null ? r.agents : {}
	) as Record<string, unknown>;
	return {
		sidecar: {
			autoDiscover:
				typeof sidecar.autoDiscover === "boolean"
					? sidecar.autoDiscover
					: d.sidecar.autoDiscover,
			binPath:
				typeof sidecar.binPath === "string"
					? sidecar.binPath
					: d.sidecar.binPath,
		},
		pollIntervalMs:
			typeof r.pollIntervalMs === "number" && r.pollIntervalMs >= 0
				? r.pollIntervalMs
				: d.pollIntervalMs,
		timezone: typeof r.timezone === "string" ? r.timezone : d.timezone,
		offlinePricing:
			typeof r.offlinePricing === "boolean"
				? r.offlinePricing
				: d.offlinePricing,
		ccusageConfigPath:
			typeof r.ccusageConfigPath === "string"
				? r.ccusageConfigPath
				: d.ccusageConfigPath,
		requestTimeoutSecs:
			typeof r.requestTimeoutSecs === "number" && r.requestTimeoutSecs > 0
				? Math.round(r.requestTimeoutSecs)
				: d.requestTimeoutSecs,
		globalAlertThresholdPct:
			typeof r.globalAlertThresholdPct === "number"
				? clampPct(r.globalAlertThresholdPct)
				: d.globalAlertThresholdPct,
		agents: {
			claude: normalizeAgent(agents.claude, d.agents.claude),
			codex: normalizeAgent(agents.codex, d.agents.codex),
		},
		home: normalizeHome(r.home),
	};
}

export async function getUsageSettings(): Promise<UsageSettings> {
	const store = await getStore();
	return normalizeUsageSettings(await store.get(USAGE_SETTINGS_KEY));
}

export async function saveUsageSettings(
	settings: UsageSettings,
): Promise<UsageSettings> {
	const store = await getStore();
	const normalized = normalizeUsageSettings(settings);
	await store.set(USAGE_SETTINGS_KEY, normalized);
	await store.save();
	return normalized;
}

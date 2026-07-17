import { getStore } from ".";

/**
 * ccusage reports token usage for many agents; mirrors the backend
 * `KNOWN_USAGE_AGENTS`. Only some ({@link USAGE_QUOTA_AGENTS}) also expose an
 * OAuth rate-limit endpoint, so only those render quota bars + use thresholds.
 */
export const USAGE_AGENT_IDS = [
	"claude",
	"codex",
	"opencode",
	"amp",
	"droid",
	"codebuff",
	"hermes",
	"pi",
	"goose",
	"kilo",
	"copilot",
	"gemini",
	"kimi",
	"qwen",
	"openclaw",
] as const;
export type UsageAgentId = (typeof USAGE_AGENT_IDS)[number];

/** Agents with an OAuth rate-limit endpoint — quota bars + alert thresholds. */
export const USAGE_QUOTA_AGENTS = ["claude", "codex"] as const;

/** Whether an agent id renders quota bars / uses an alert threshold. */
export function isQuotaAgent(id: string): boolean {
	return (USAGE_QUOTA_AGENTS as readonly string[]).includes(id);
}

export interface UsageAgentSettings {
	/** Whether the usage surface polls and shows this agent. */
	tracked: boolean;
	/**
	 * Per-agent alert threshold, percent of a rate-limit window (0–100). `null`
	 * falls back to {@link UsageSettings.globalAlertThresholdPct}. Only
	 * meaningful for {@link USAGE_QUOTA_AGENTS}.
	 */
	alertThresholdPct: number | null;
}

/** Per-agent settings default: tracked, on the global threshold. */
export const DEFAULT_AGENT_SETTINGS: UsageAgentSettings = {
	tracked: true,
	alertThresholdPct: null,
};

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

/**
 * One card's fixed slot arrangement. Array index is the slot; `null` is an empty
 * slot kept in place. Fields not in a slot are the palette (derived, not stored).
 */
export interface CardLayout {
	/** Length {@link CARD_WINDOW_SLOTS}. */
	windowSlots: (HomeWindowId | null)[];
	/** Length {@link CARD_STAT_SLOTS}. */
	statSlots: (HomeStatId | null)[];
}

/** How the usage block on the home agent cards is rendered. */
export interface UsageHomeSettings {
	/** Master switch for the usage block on home cards. */
	showUsageOnHome: boolean;
	/** Rolling window (days) for the summary query that feeds the home cards. */
	windowDays: number;
	/** The layout every agent uses unless it has a {@link perAgent} override. */
	default: CardLayout;
	/** Per-agent layout overrides, keyed by agent id. */
	perAgent: Record<string, CardLayout>;
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
	/** Raw extra ccusage flags appended verbatim (power-user passthrough). */
	extraArgs: string;
	/** Global alert threshold, percent of a rate-limit window (0–100). */
	globalAlertThresholdPct: number;
	/** Sparse per-agent overrides; missing agents use {@link DEFAULT_AGENT_SETTINGS}. */
	agents: Record<string, UsageAgentSettings>;
	home: UsageHomeSettings;
}

/** Resolve an agent's settings, falling back to the defaults when unset. */
export function agentSettings(
	settings: UsageSettings,
	id: string,
): UsageAgentSettings {
	return settings.agents[id] ?? DEFAULT_AGENT_SETTINGS;
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

/** The default card layout, shared by every agent without an override. */
export const DEFAULT_CARD_LAYOUT: CardLayout = {
	windowSlots: DEFAULT_WINDOW_SLOTS,
	statSlots: DEFAULT_STAT_SLOTS,
};

export const DEFAULT_USAGE_SETTINGS: UsageSettings = {
	sidecar: { autoDiscover: true, binPath: "" },
	pollIntervalMs: 60_000,
	timezone: "",
	offlinePricing: true,
	ccusageConfigPath: "",
	requestTimeoutSecs: 30,
	extraArgs: "",
	globalAlertThresholdPct: 80,
	agents: {
		claude: { ...DEFAULT_AGENT_SETTINGS },
		codex: { ...DEFAULT_AGENT_SETTINGS },
	},
	home: {
		showUsageOnHome: true,
		windowDays: 30,
		default: DEFAULT_CARD_LAYOUT,
		perAgent: {},
	},
};

/** Alert-threshold presets, percent of a rate-limit window. */
export const USAGE_ALERT_THRESHOLDS_PCT = [
	50, 60, 70, 75, 80, 85, 90, 95,
] as const;

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

/** Normalize one card layout, migrating the older flat + `{id,visible}[]` shapes. */
function normalizeLayout(raw: unknown): CardLayout {
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	return {
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
					) ?? [...DEFAULT_WINDOW_SLOTS]),
		statSlots:
			r.statSlots !== undefined
				? normalizeSlots(r.statSlots, HOME_STAT_ID_SET, CARD_STAT_SLOTS)
				: (slotsFromLegacy(
						r.stats,
						HOME_STAT_ID_SET,
						CARD_STAT_SLOTS,
					) ?? [...DEFAULT_STAT_SLOTS]),
	};
}

function normalizeHome(raw: unknown): UsageHomeSettings {
	const d = DEFAULT_USAGE_SETTINGS.home;
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	// `default` present = new shape; otherwise migrate the old flat layout
	// (home.windowSlots / home.stats) into the default.
	const defaultLayout =
		r.default !== undefined
			? normalizeLayout(r.default)
			: normalizeLayout(r);
	const perAgent: Record<string, CardLayout> = {};
	if (typeof r.perAgent === "object" && r.perAgent !== null) {
		for (const [id, layout] of Object.entries(
			r.perAgent as Record<string, unknown>,
		)) {
			perAgent[id] = normalizeLayout(layout);
		}
	}
	return {
		showUsageOnHome: normalizeBool(r.showUsageOnHome, d.showUsageOnHome),
		windowDays:
			typeof r.windowDays === "number" && r.windowDays > 0
				? Math.round(r.windowDays)
				: d.windowDays,
		default: defaultLayout,
		perAgent,
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
		extraArgs: typeof r.extraArgs === "string" ? r.extraArgs : d.extraArgs,
		globalAlertThresholdPct:
			typeof r.globalAlertThresholdPct === "number"
				? clampPct(r.globalAlertThresholdPct)
				: d.globalAlertThresholdPct,
		// Sparse: always seed the quota agents, carry over any other stored ones.
		agents: Object.fromEntries(
			[...new Set([...USAGE_QUOTA_AGENTS, ...Object.keys(agents)])].map(
				(id) => [
					id,
					normalizeAgent(agents[id], DEFAULT_AGENT_SETTINGS),
				],
			),
		),
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

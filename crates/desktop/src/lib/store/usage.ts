import { getStore } from ".";

/** Agents with an OAuth rate-limit endpoint — quota bars + warning levels. */
export const USAGE_QUOTA_AGENTS = ["claude", "codex"] as const;

interface UsageAgentSettings {
	/**
	 * Per-agent warning level, percent of a rate-limit window (0–100). `null`
	 * falls back to {@link UsageSettings.globalAlertThresholdPct}. Only
	 * meaningful for {@link USAGE_QUOTA_AGENTS}.
	 */
	alertThresholdPct: number | null;
}

/** Per-agent settings default: use the global warning level. */
const DEFAULT_AGENT_SETTINGS: UsageAgentSettings = {
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
export const HOME_WINDOW_IDS = ["weekly", "5h", "weekly_opus"] as const;
export type HomeWindowId = (typeof HOME_WINDOW_IDS)[number];

/** Fixed bar slots on the card (a vertical stack). */
const CARD_WINDOW_SLOTS = 3;
/** Fixed stat slots on the card (a 2×2 corner grid). */
const CARD_STAT_SLOTS = 4;

/**
 * One card's fixed slot arrangement. Array index is the slot; `null` is an empty
 * slot kept in place. Fields not in a slot are the palette (derived, not stored).
 */
interface CardLayout {
	/** Length {@link CARD_WINDOW_SLOTS}. */
	windowSlots: (HomeWindowId | null)[];
	/** Length {@link CARD_STAT_SLOTS}. */
	statSlots: (HomeStatId | null)[];
}

/** How the usage block on the home agent cards is rendered. */
interface UsageHomeSettings {
	/** Master switch for the usage block on home cards. */
	showUsageOnHome: boolean;
	/** Rolling window (days) for the summary query that feeds the home cards. */
	windowDays: number;
	/** The layout every agent uses unless it has a {@link perAgent} override. */
	default: CardLayout;
	/** Per-agent layout overrides, keyed by agent id. */
	perAgent: Record<string, CardLayout>;
}

export const USAGE_REPORT_RANGE_MODES = ["last30", "all", "custom"] as const;
export type UsageReportRangeMode = (typeof USAGE_REPORT_RANGE_MODES)[number];

export interface UsageReportRangeSettings {
	mode: UsageReportRangeMode;
	/** Inclusive ISO date used when {@link mode} is `custom`. */
	since: string;
	/** Inclusive ISO date used when {@link mode} is `custom`. */
	until: string;
}

export interface UsageSettings {
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
	/**
	 * Additional ccusage arguments. The API splits on whitespace, so one value
	 * cannot contain spaces.
	 */
	extraArgs: string;
	/** Global warning level, percent of a rate-limit window (0–100). */
	globalAlertThresholdPct: number;
	/** Sparse per-agent overrides; missing agents use {@link DEFAULT_AGENT_SETTINGS}. */
	agents: Record<string, UsageAgentSettings>;
	/** Date range shown on the dedicated Usage page. */
	reportRange: UsageReportRangeSettings;
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

/** TanStack Query polling accepts disabled (0) or a 1-second to 24-hour timer. */
const USAGE_POLL_INTERVAL_MIN_MS = 1_000;
export const USAGE_POLL_INTERVAL_MAX_SECS = 24 * 60 * 60;
const USAGE_POLL_INTERVAL_MAX_MS = USAGE_POLL_INTERVAL_MAX_SECS * 1_000;

/** The ccusage process timeout setting is limited to 1 second through 1 hour. */
const USAGE_REQUEST_TIMEOUT_MIN_SECS = 1;
export const USAGE_REQUEST_TIMEOUT_MAX_SECS = 60 * 60;

/** Home summary queries cover between 1 day and 1 calendar year. */
const USAGE_HOME_WINDOW_MIN_DAYS = 1;
const USAGE_HOME_WINDOW_MAX_DAYS = 365;

/** Default bar slots — one weekly quota row. */
const DEFAULT_WINDOW_SLOTS: (HomeWindowId | null)[] = ["weekly", null, null];

/** Default stat slots — input/output first, then total tokens and spend. */
const DEFAULT_STAT_SLOTS: (HomeStatId | null)[] = [
	"inputTokens",
	"outputTokens",
	"totalTokens",
	"cost",
];

export function createDefaultUsageSettings(): UsageSettings {
	return {
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
		reportRange: {
			mode: "last30",
			since: "",
			until: "",
		},
		home: {
			showUsageOnHome: true,
			windowDays: 30,
			default: {
				windowSlots: [...DEFAULT_WINDOW_SLOTS],
				statSlots: [...DEFAULT_STAT_SLOTS],
			},
			perAgent: {},
		},
	};
}

export const DEFAULT_USAGE_SETTINGS = createDefaultUsageSettings();

/** Alert-threshold presets, percent of a rate-limit window. */
export const USAGE_ALERT_THRESHOLDS_PCT = [
	50, 60, 70, 75, 80, 85, 90, 95,
] as const;

function clampPct(value: number): number {
	if (!Number.isFinite(value))
		return DEFAULT_USAGE_SETTINGS.globalAlertThresholdPct;
	return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeAgent(raw: unknown): UsageAgentSettings {
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	const threshold = r.alertThresholdPct;
	return {
		alertThresholdPct:
			typeof threshold === "number" && Number.isFinite(threshold)
				? clampPct(threshold)
				: null,
	};
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function normalizeFiniteInteger(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizePollInterval(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	if (value === 0) return 0;
	return normalizeFiniteInteger(
		value,
		fallback,
		USAGE_POLL_INTERVAL_MIN_MS,
		USAGE_POLL_INTERVAL_MAX_MS,
	);
}

function normalizeTimezone(value: unknown): string {
	if (typeof value !== "string" || value === "") return "";
	try {
		new Intl.DateTimeFormat("en-US", {
			timeZone: value,
		}).resolvedOptions();
		return value;
	} catch {
		return "";
	}
}

const HOME_STAT_ID_SET = new Set<HomeStatId>(HOME_STAT_IDS);
const HOME_WINDOW_ID_SET = new Set<HomeWindowId>(HOME_WINDOW_IDS);
const USAGE_REPORT_RANGE_MODE_SET = new Set<UsageReportRangeMode>(
	USAGE_REPORT_RANGE_MODES,
);

function isIsoDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const date = new Date(`${value}T00:00:00Z`);
	return (
		!Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value)
	);
}

function normalizeReportRange(raw: unknown): UsageReportRangeSettings {
	const d = DEFAULT_USAGE_SETTINGS.reportRange;
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	const mode = USAGE_REPORT_RANGE_MODE_SET.has(r.mode as UsageReportRangeMode)
		? (r.mode as UsageReportRangeMode)
		: d.mode;
	if (mode !== "custom") return { mode, since: "", until: "" };
	if (!isIsoDate(r.since) || !isIsoDate(r.until) || r.since > r.until) {
		return { ...d };
	}
	return { mode, since: r.since, until: r.until };
}

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

/** Normalize one fixed-slot card layout from the persisted store. */
function normalizeLayout(raw: unknown): CardLayout {
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	return {
		windowSlots: normalizeSlots(
			r.windowSlots ?? DEFAULT_WINDOW_SLOTS,
			HOME_WINDOW_ID_SET,
			CARD_WINDOW_SLOTS,
		),
		statSlots: normalizeSlots(
			r.statSlots ?? DEFAULT_STAT_SLOTS,
			HOME_STAT_ID_SET,
			CARD_STAT_SLOTS,
		),
	};
}

function normalizeHome(raw: unknown): UsageHomeSettings {
	const d = DEFAULT_USAGE_SETTINGS.home;
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
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
		windowDays: normalizeFiniteInteger(
			r.windowDays,
			d.windowDays,
			USAGE_HOME_WINDOW_MIN_DAYS,
			USAGE_HOME_WINDOW_MAX_DAYS,
		),
		default: normalizeLayout(r.default),
		perAgent,
	};
}

/**
 * Merge a stored, possibly partial value onto the defaults so the
 * panel and the Rust reader always see a complete, well-typed shape.
 */
function normalizeUsageSettings(raw: unknown): UsageSettings {
	const d = DEFAULT_USAGE_SETTINGS;
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
		string,
		unknown
	>;
	const agents = (
		typeof r.agents === "object" && r.agents !== null ? r.agents : {}
	) as Record<string, unknown>;
	return {
		pollIntervalMs: normalizePollInterval(
			r.pollIntervalMs,
			d.pollIntervalMs,
		),
		timezone: normalizeTimezone(r.timezone),
		offlinePricing:
			typeof r.offlinePricing === "boolean"
				? r.offlinePricing
				: d.offlinePricing,
		ccusageConfigPath:
			typeof r.ccusageConfigPath === "string"
				? r.ccusageConfigPath
				: d.ccusageConfigPath,
		requestTimeoutSecs: normalizeFiniteInteger(
			r.requestTimeoutSecs,
			d.requestTimeoutSecs,
			USAGE_REQUEST_TIMEOUT_MIN_SECS,
			USAGE_REQUEST_TIMEOUT_MAX_SECS,
		),
		extraArgs: typeof r.extraArgs === "string" ? r.extraArgs : d.extraArgs,
		globalAlertThresholdPct:
			typeof r.globalAlertThresholdPct === "number"
				? clampPct(r.globalAlertThresholdPct)
				: d.globalAlertThresholdPct,
		// Sparse: always seed the quota agents, carry over any other stored ones.
		agents: Object.fromEntries(
			[...new Set([...USAGE_QUOTA_AGENTS, ...Object.keys(agents)])].map(
				(id) => [id, normalizeAgent(agents[id])],
			),
		),
		reportRange: normalizeReportRange(r.reportRange),
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

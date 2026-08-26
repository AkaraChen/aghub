import type { TFunction } from "i18next";
import type {
	GatewayInstanceStatus,
	GatewayOauthProvider,
	GatewayUpstreamProvider,
	GatewayUsageDto,
} from "../../generated/dto";
import type { GatewayLaunchStage } from "../../hooks/use-gateway-launch";

interface GatewayStatusDisplay {
	labelKey: string;
	dotClass: string;
}

export const GATEWAY_STATUS_DISPLAY: Record<
	GatewayInstanceStatus,
	GatewayStatusDisplay
> = {
	not_provisioned: {
		labelKey: "gatewayStatusNotProvisioned",
		dotClass: "bg-foreground/30",
	},
	stopped: {
		labelKey: "gatewayStatusStopped",
		dotClass: "bg-foreground/30",
	},
	starting: {
		labelKey: "gatewayStatusStarting",
		dotClass: "bg-accent",
	},
	running: {
		labelKey: "gatewayStatusRunning",
		dotClass: "bg-success",
	},
	unhealthy: {
		labelKey: "gatewayStatusUnhealthy",
		dotClass: "bg-warning",
	},
};

const URL_PROTOCOL_REGEX = /^[a-z][a-z0-9+.-]*:\/\//i;
const TRAILING_SLASHES_REGEX = /\/+$/;

/** `http://127.0.0.1:8317/` → `127.0.0.1:8317` for compact meta rows. */
export function displayGatewayHost(baseUrl: string): string {
	return baseUrl
		.replace(URL_PROTOCOL_REGEX, "")
		.replace(TRAILING_SLASHES_REGEX, "");
}

interface GatewayOauthProviderOption {
	id: GatewayOauthProvider;
	/** Brand name, shown verbatim in every locale. */
	label: string;
	/** File name under `@lobehub/icons-static-svg/icons/`. */
	logo: string;
}

export const GATEWAY_OAUTH_PROVIDER_OPTIONS: GatewayOauthProviderOption[] = [
	{ id: "anthropic", label: "Claude", logo: "claude" },
	{ id: "codex", label: "Codex", logo: "openai" },
	{ id: "antigravity", label: "Gemini (Antigravity)", logo: "gemini" },
	{ id: "kimi", label: "Kimi", logo: "kimi" },
	{ id: "xai", label: "xAI (Grok)", logo: "grok" },
];

const GATEWAY_SETTING_GROUP_LABEL_KEYS: Record<string, string> = {
	logging: "gatewaySettingGroupLogging",
	usage: "gatewaySettingGroupUsage",
	security: "gatewaySettingGroupSecurity",
	network: "gatewaySettingGroupNetwork",
	quota: "gatewaySettingGroupQuota",
};

const GATEWAY_SETTING_GROUP_ORDER = [
	"logging",
	"usage",
	"security",
	"network",
	"quota",
];

export function gatewaySettingGroupLabelKey(group: string): string | null {
	return GATEWAY_SETTING_GROUP_LABEL_KEYS[group] ?? null;
}

export function compareGatewaySettingGroups(a: string, b: string): number {
	const aIndex = GATEWAY_SETTING_GROUP_ORDER.indexOf(a);
	const bIndex = GATEWAY_SETTING_GROUP_ORDER.indexOf(b);
	if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
	if (aIndex === -1) return 1;
	if (bIndex === -1) return -1;
	return aIndex - bIndex;
}

export interface GatewayUsageRow {
	provider: string;
	identifier: string;
	success: number;
	failed: number;
}

export function flattenGatewayUsage(usage: GatewayUsageDto): GatewayUsageRow[] {
	const rows: GatewayUsageRow[] = [];
	for (const [provider, byIdentifier] of Object.entries(usage.providers)) {
		for (const [identifier, counters] of Object.entries(byIdentifier)) {
			rows.push({
				provider,
				identifier,
				success: counters.success,
				failed: counters.failed,
			});
		}
	}
	rows.sort(
		(a, b) =>
			a.provider.localeCompare(b.provider) ||
			a.identifier.localeCompare(b.identifier),
	);
	return rows;
}

/**
 * In-flight label for the launch button; the idle label is the
 * caller's ("Install and start" vs plain "Install").
 */
export function gatewayLaunchLabel(
	t: TFunction,
	stage: GatewayLaunchStage,
	progress: number | null,
): string {
	switch (stage) {
		case "downloading":
			return progress == null
				? t("gatewayProvisionDownloading")
				: t("gatewayDownloadingPercent", {
						percent: Math.round(progress),
					});
		case "starting":
			return t("gatewayLaunching");
		default:
			return t("gatewayLaunchPreparing");
	}
}

/**
 * `preset` marker the backend stamps on inference-provider entries it
 * mirrors from gateway instances.
 */
export const GATEWAY_MANAGED_PRESET = "aghub-gateway";

interface GatewayUpstreamProviderOption {
	id: GatewayUpstreamProvider;
	/** Brand name, shown verbatim in every locale. */
	label: string;
	/** File name under `@lobehub/icons-static-svg/icons/`. */
	logo: string;
}

export const GATEWAY_UPSTREAM_PROVIDER_OPTIONS: GatewayUpstreamProviderOption[] =
	[
		{ id: "gemini", label: "Gemini", logo: "gemini" },
		{ id: "claude", label: "Claude", logo: "claude" },
		{ id: "codex", label: "Codex", logo: "openai" },
	];

/** `sk-abcdef…wxyz` style masking: first 6 + last 4, bullets between. */
export function maskGatewayKey(key: string): string {
	if (key.length <= 10) {
		return "•".repeat(Math.max(key.length, 4));
	}
	return `${key.slice(0, 6)}•••${key.slice(-4)}`;
}

export function formatGatewayModtime(modtime: string | null): string {
	if (!modtime) return "—";
	const date = new Date(modtime);
	if (Number.isNaN(date.getTime())) return modtime;
	return date.toLocaleString();
}

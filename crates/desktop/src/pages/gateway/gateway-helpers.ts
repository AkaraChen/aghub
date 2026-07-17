import type {
	GatewayInstanceStatus,
	GatewayOauthProvider,
	GatewayUsageDto,
} from "../../generated/dto";

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
		dotClass: "bg-danger",
	},
};

interface GatewayOauthProviderOption {
	id: GatewayOauthProvider;
	/** Brand name, shown verbatim in every locale. */
	label: string;
}

export const GATEWAY_OAUTH_PROVIDER_OPTIONS: GatewayOauthProviderOption[] = [
	{ id: "anthropic", label: "Claude" },
	{ id: "codex", label: "Codex" },
	{ id: "antigravity", label: "Gemini (Antigravity)" },
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

export function formatGatewayModtime(modtime: string | null): string {
	if (!modtime) return "—";
	const date = new Date(modtime);
	if (Number.isNaN(date.getTime())) return modtime;
	return date.toLocaleString();
}

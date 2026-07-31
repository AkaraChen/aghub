import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { AgentIcon } from "../../lib/agent-icons";
import {
	agentSettings,
	USAGE_ALERT_THRESHOLDS_PCT,
	USAGE_QUOTA_AGENTS,
	type UsageSettings,
} from "../../lib/store";
import { USAGE_AGENT_LABELS } from "../../lib/usage-agents";
import { SettingRow, SettingSelect } from "./usage-setting-controls";
import {
	includeSelectedOption,
	type UsageSectionProps,
} from "./usage-setting-model";

const GLOBAL_THRESHOLD_KEY = "global";

const THRESHOLD_OPTIONS = USAGE_ALERT_THRESHOLDS_PCT.map((pct) => ({
	id: String(pct),
	label: `${pct}%`,
}));

export function AlertsSection({ current, updateSettings }: UsageSectionProps) {
	const { t } = useTranslation();
	const { availableAgents } = useAgentAvailability();
	const enabledAgentIds = new Set(
		availableAgents
			.filter((agent) => agent.isUsable)
			.map((agent) => agent.id),
	);
	const agentName = (id: string) =>
		availableAgents.find((agent) => agent.id === id)?.display_name ??
		USAGE_AGENT_LABELS[id] ??
		id;
	const update = (patch: Partial<UsageSettings>) => {
		updateSettings((settings) => ({ ...settings, ...patch }));
	};
	const updateAgent = (
		agent: string,
		patch: Partial<UsageSettings["agents"][string]>,
	) => {
		updateSettings((settings) => ({
			...settings,
			agents: {
				...settings.agents,
				[agent]: { ...agentSettings(settings, agent), ...patch },
			},
		}));
	};

	return (
		<section className="space-y-4 px-1 py-5">
			<div className="space-y-0.5">
				<span className="text-sm font-semibold text-(--foreground)">
					{t("usageSettingsAlerts")}
				</span>
				<span className="block text-xs text-muted">
					{t("usageSettingsAlertsDescription")}
				</span>
			</div>
			<SettingRow
				title={t("usageGlobalAlertThreshold")}
				control={
					<SettingSelect
						value={String(current.globalAlertThresholdPct)}
						onChange={(globalAlertThresholdPct) =>
							update({
								globalAlertThresholdPct: Number(
									globalAlertThresholdPct,
								),
							})
						}
						ariaLabel={t("usageGlobalAlertThreshold")}
						options={includeSelectedOption(
							THRESHOLD_OPTIONS,
							String(current.globalAlertThresholdPct),
							`${current.globalAlertThresholdPct}%`,
						)}
					/>
				}
			/>
			{USAGE_QUOTA_AGENTS.map((agent) => {
				const config = agentSettings(current, agent);
				const selectedThreshold =
					config.alertThresholdPct === null
						? GLOBAL_THRESHOLD_KEY
						: String(config.alertThresholdPct);
				const thresholdOptions = [
					{
						id: GLOBAL_THRESHOLD_KEY,
						label: t("usageAlertUseGlobal", {
							pct: current.globalAlertThresholdPct,
						}),
					},
					...THRESHOLD_OPTIONS,
				];
				const displayName = agentName(agent);
				return (
					<div
						key={agent}
						className="flex items-center justify-between gap-4 border-t border-border pt-4"
					>
						<span className="flex items-center gap-2 text-sm font-medium text-(--foreground)">
							<AgentIcon
								id={agent}
								name={displayName}
								size="xs"
							/>
							{displayName}
						</span>
						<SettingSelect
							value={selectedThreshold}
							onChange={(key) =>
								updateAgent(agent, {
									alertThresholdPct:
										key === GLOBAL_THRESHOLD_KEY
											? null
											: Number(key),
								})
							}
							ariaLabel={t("usageAgentAlert")}
							isDisabled={!enabledAgentIds.has(agent)}
							options={includeSelectedOption(
								thresholdOptions,
								selectedThreshold,
								`${config.alertThresholdPct}%`,
							)}
						/>
					</div>
				);
			})}
		</section>
	);
}

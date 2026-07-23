import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import { agentSettings } from "../../lib/store";
import { USAGE_AGENT_LABELS } from "../../lib/usage-agents";
import { usageAgentsQueryOptions } from "../../requests/usage";
import { SettingRow, SettingSwitch } from "./usage-setting-controls";
import type { UsageSectionProps } from "./usage-setting-model";

export function TrackedAgentsSection({
	current,
	updateSettings,
}: UsageSectionProps) {
	const { t } = useTranslation();
	const api = useApi();
	const { availableAgents } = useAgentAvailability();
	const agentsQuery = useQuery(usageAgentsQueryOptions({ api }));
	const displayNames = new Map(
		availableAgents.map((agent) => [agent.id, agent.display_name]),
	);
	const updateAgent = (id: string, tracked: boolean) => {
		updateSettings((settings) => ({
			...settings,
			agents: {
				...settings.agents,
				[id]: {
					...agentSettings(settings, id),
					tracked,
				},
			},
		}));
	};

	return (
		<section data-testid="tracked-agents" className="space-y-4 px-1 py-5">
			<div className="space-y-0.5">
				<span className="text-sm font-semibold text-(--foreground)">
					{t("usageSettingsTrackedAgents")}
				</span>
				<span className="block text-xs text-muted">
					{t("usageSettingsTrackedAgentsDescription")}
				</span>
			</div>
			{agentsQuery.isPending ? (
				<p className="text-xs text-muted">{t("usageStatusChecking")}</p>
			) : agentsQuery.isError ? (
				<p className="text-xs text-danger">
					{t("usageTrackedAgentsLoadError")}
				</p>
			) : (
				<div className="divide-y divide-border">
					{agentsQuery.data.map((id) => {
						const name =
							displayNames.get(id) ??
							USAGE_AGENT_LABELS[id] ??
							id;
						return (
							<div key={id} className="py-3 first:pt-0 last:pb-0">
								<SettingRow
									title={name}
									control={
										<SettingSwitch
											isSelected={
												agentSettings(current, id)
													.tracked
											}
											onChange={(tracked) =>
												updateAgent(id, tracked)
											}
											ariaLabel={t("usageAgentTracked", {
												agent: name,
											})}
										/>
									}
								/>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}

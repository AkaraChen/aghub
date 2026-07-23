import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import {
	HOME_STAT_IDS,
	type HomeStatId,
	HOME_WINDOW_IDS,
	type HomeWindowId,
	USAGE_QUOTA_AGENTS,
	type UsageSettings,
} from "../../lib/store";
import {
	HOME_STAT_AGENT_HINT,
	HOME_STAT_DEFINITIONS,
	HOME_WINDOW_LABEL_KEYS,
} from "../../lib/usage-home-fields";
import { USAGE_AGENT_LABELS } from "../../lib/usage-agents";
import { usageAgentsQueryOptions } from "../../requests/usage";
import {
	type CardLayoutModel,
	InteractiveCardLayout,
	type LayoutField,
} from "./usage-layout-editor";
import {
	SettingRow,
	SettingSelect,
	SettingSwitch,
} from "./usage-setting-controls";
import {
	includeSelectedOption,
	type UsageSectionProps,
} from "./usage-setting-model";

const USAGE_WINDOW_DAYS = [7, 14, 30, 90] as const;

export function HomeCardsSection({
	current,
	updateSettings,
	layoutTarget,
	onLayoutTargetChange,
}: UsageSectionProps & {
	layoutTarget: string;
	onLayoutTargetChange: (target: string) => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const { availableAgents } = useAgentAvailability();
	const usageAgentsQuery = useQuery(usageAgentsQueryOptions({ api }));
	const home = current.home;
	const editedLayout =
		layoutTarget === "default"
			? home.default
			: (home.perAgent[layoutTarget] ?? home.default);
	const hasOverride =
		layoutTarget !== "default" && layoutTarget in home.perAgent;
	const updateHome = (patch: Partial<UsageSettings["home"]>) => {
		updateSettings((settings) => ({
			...settings,
			home: { ...settings.home, ...patch },
		}));
	};
	const commitLayout = (next: CardLayoutModel) => {
		const layout = {
			windowSlots: next.windowSlots as (HomeWindowId | null)[],
			statSlots: next.statSlots as (HomeStatId | null)[],
		};
		updateSettings((settings) => ({
			...settings,
			home:
				layoutTarget === "default"
					? { ...settings.home, default: layout }
					: {
							...settings.home,
							perAgent: {
								...settings.home.perAgent,
								[layoutTarget]: layout,
							},
						},
		}));
	};
	const resetOverride = () => {
		updateSettings((settings) => {
			const perAgent = { ...settings.home.perAgent };
			delete perAgent[layoutTarget];
			return {
				...settings,
				home: { ...settings.home, perAgent },
			};
		});
	};
	const offeredToTarget = (id: HomeWindowId | HomeStatId) => {
		if (
			layoutTarget !== "default" &&
			isHomeWindowId(id) &&
			!USAGE_QUOTA_AGENTS.includes(
				layoutTarget as (typeof USAGE_QUOTA_AGENTS)[number],
			)
		) {
			return false;
		}
		const agent = layoutFieldAgent(id);
		return layoutTarget === "default" || !agent || agent === layoutTarget;
	};
	const fieldHint = (id: HomeWindowId | HomeStatId) => {
		const agent = layoutFieldAgent(id);
		return layoutTarget === "default" && agent
			? t(
					agent === "claude"
						? "usageStatClaudeOnly"
						: "usageStatCodexOnly",
				)
			: undefined;
	};
	const windowFields: LayoutField[] = HOME_WINDOW_IDS.filter(
		offeredToTarget,
	).map((id) => ({
		id,
		label: t(HOME_WINDOW_LABEL_KEYS[id]),
		hint: fieldHint(id),
	}));
	const statFields: LayoutField[] = HOME_STAT_IDS.filter(offeredToTarget).map(
		(id) => ({
			id,
			label: t(HOME_STAT_DEFINITIONS[id].labelKey),
			hint: fieldHint(id),
		}),
	);
	const previewAgentId =
		layoutTarget === "default" ? USAGE_QUOTA_AGENTS[0] : layoutTarget;
	const layoutTargets = usageAgentsQuery.data ?? USAGE_QUOTA_AGENTS;
	const agentName = (id: string) =>
		availableAgents.find((agent) => agent.id === id)?.display_name ??
		USAGE_AGENT_LABELS[id] ??
		id;

	return (
		<section className="space-y-4 px-1 py-5">
			<div className="space-y-0.5">
				<span className="text-sm font-semibold text-(--foreground)">
					{t("usageSettingsHomeCards")}
				</span>
				<span className="block text-xs text-muted">
					{t("usageHomeShowDescription")}
				</span>
			</div>
			<SettingRow
				title={t("usageHomeShow")}
				control={
					<SettingSwitch
						isSelected={home.showUsageOnHome}
						onChange={(showUsageOnHome) =>
							updateHome({ showUsageOnHome })
						}
						ariaLabel={t("usageHomeShow")}
					/>
				}
			/>
			<SettingRow
				title={t("usageHomeWindow")}
				description={t("usageHomeWindowDescription")}
				control={
					<SettingSelect
						value={String(home.windowDays)}
						onChange={(days) =>
							updateHome({ windowDays: Number(days) })
						}
						isDisabled={!home.showUsageOnHome}
						ariaLabel={t("usageHomeWindow")}
						options={includeSelectedOption(
							USAGE_WINDOW_DAYS.map((days) => ({
								id: String(days),
								label: t("usageWindowDaysOption", { days }),
							})),
							String(home.windowDays),
							t("usageWindowDaysOption", {
								days: home.windowDays,
							}),
						)}
					/>
				}
			/>
			<div className="w-full space-y-3 border-t border-border pt-4">
				<div className="flex items-center justify-between gap-3">
					<div className="space-y-0.5">
						<span className="text-sm font-medium text-(--foreground)">
							{t("usageHomeLayout")}
						</span>
						<span className="block text-xs text-muted">
							{t("usageHomeLayoutDescription")}
						</span>
					</div>
					<div className="flex shrink-0 items-center gap-3">
						{hasOverride && (
							<Button
								size="sm"
								variant="ghost"
								onPress={resetOverride}
								className="h-7 px-2 text-xs text-muted"
							>
								{t("usageLayoutResetOverride")}
							</Button>
						)}
						<SettingSelect
							value={layoutTarget}
							onChange={onLayoutTargetChange}
							ariaLabel={t("usageLayoutTarget")}
							options={[
								{
									id: "default",
									label: t("usageLayoutTargetDefault"),
								},
								...layoutTargets.map((id) => ({
									id,
									label: agentName(id),
								})),
							]}
						/>
					</div>
				</div>
				<InteractiveCardLayout
					windowFields={windowFields}
					statFields={statFields}
					windowSlots={editedLayout.windowSlots}
					statSlots={editedLayout.statSlots}
					isDisabled={!home.showUsageOnHome}
					onCommit={commitLayout}
					preview={{
						agentId: previewAgentId,
						agentName:
							USAGE_AGENT_LABELS[previewAgentId] ??
							previewAgentId,
					}}
				/>
			</div>
		</section>
	);
}

function layoutFieldAgent(
	id: HomeWindowId | HomeStatId,
): "claude" | "codex" | undefined {
	if (id === "weekly_opus") return "claude";
	const stat = HOME_STAT_IDS.find((candidate) => candidate === id);
	return stat ? HOME_STAT_AGENT_HINT[stat] : undefined;
}

function isHomeWindowId(id: HomeWindowId | HomeStatId): id is HomeWindowId {
	return HOME_WINDOW_IDS.includes(id as HomeWindowId);
}

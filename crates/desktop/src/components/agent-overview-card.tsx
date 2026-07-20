import { ArrowRightIcon, FolderOpenIcon } from "@heroicons/react/24/solid";
import { Button, Card, Meter, toast, Tooltip } from "@heroui/react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { AvailableAgent } from "../contexts/agent-availability";
import type {
	AgentLimitsDto,
	AgentUsageDto,
	LimitWindowDto,
} from "../generated/dto";
import { useAgentConfigPath } from "../hooks/use-agent-config-path";
import { agentStatus } from "../lib/agent-status";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";
import { clampPct, meterColor, quotaWindowLabelKey } from "../lib/usage-format";
import {
	DEFAULT_STAT_SLOTS,
	DEFAULT_WINDOW_SLOTS,
	type HomeStatId,
	type HomeWindowId,
} from "../lib/store";
import { buildUsage } from "./agent-overview-card-helpers";

/** Home-card usage display preferences, resolved per agent by the home page. */
export interface AgentUsageDisplay {
	/** Effective alert threshold for this agent's quota bars (0–100). */
	alertThresholdPct: number;
	/** Fixed bar slots; `null` = empty slot. */
	windowSlots: (HomeWindowId | null)[];
	/** Fixed stat slots (2×2); `null` = empty slot. */
	statSlots: (HomeStatId | null)[];
}

const DEFAULT_USAGE_DISPLAY: AgentUsageDisplay = {
	alertThresholdPct: 90,
	windowSlots: DEFAULT_WINDOW_SLOTS,
	statSlots: DEFAULT_STAT_SLOTS,
};

interface AgentOverviewCardProps {
	agent: AvailableAgent;
	skillCount: number;
	mcpCount: number;
	/** Consumed tokens/cost for this agent, when the usage backend reports it. */
	usage?: AgentUsageDto;
	/** Remaining rate-limit windows for this agent, when available. */
	limits?: AgentLimitsDto;
	/** How to render the usage block; defaults to the shared card layout. */
	usageDisplay?: AgentUsageDisplay;
}

export function AgentOverviewCard({
	agent,
	skillCount,
	mcpCount,
	usage,
	limits,
	usageDisplay = DEFAULT_USAGE_DISPLAY,
}: AgentOverviewCardProps) {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const { data: configPath } = useAgentConfigPath(agent);
	const status = agentStatus(agent);
	const view = buildUsage({
		usage,
		limits,
		statSlots: usageDisplay.statSlots,
		windowSlots: usageDisplay.windowSlots,
	});
	const showQuota = view.windows.length > 0;
	const showStats = view.hasStatData;
	// Stable per-slot keys so empty slots don't fall back to array-index keys.
	const statCellList = view.statCells.map((cell, index) => ({
		key: cell ? `stat-${cell.id}` : `stat-empty-${index}`,
		cell,
	}));

	function openResource(resource: "skills" | "mcp") {
		setLocation(`/${resource}?agent=${encodeURIComponent(agent.id)}`);
	}

	async function handleOpenConfigFolder() {
		if (!configPath) return;
		try {
			await revealItemInDir(configPath);
		} catch (error) {
			console.error(
				`Failed to reveal config folder for ${agent.id}:`,
				error,
			);
			toast.danger(
				t("openAgentConfigFolderFailed", { name: agent.display_name }),
			);
		}
	}

	const tall = showQuota || showStats;

	return (
		<Card
			className={cn(
				"p-3 !rounded-lg",
				tall ? "row-span-2" : "row-span-1",
			)}
		>
			<Card.Header className="flex flex-row items-center gap-2 p-0">
				<AgentIcon id={agent.id} name={agent.display_name} size="xs" />
				<Card.Title className="min-w-0 flex-1 truncate text-sm font-medium">
					{agent.display_name}
				</Card.Title>
				{configPath && (
					<Tooltip>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="size-7 text-muted transition-colors hover:bg-accent/10 hover:text-accent focus-visible:bg-accent/10 focus-visible:text-accent"
							aria-label={t("openAgentConfigFolder", {
								name: agent.display_name,
							})}
							onPress={handleOpenConfigFolder}
						>
							<FolderOpenIcon className="size-3.5" />
						</Button>
						<Tooltip.Content>
							{t("openConfigFolder")}
						</Tooltip.Content>
					</Tooltip>
				)}
			</Card.Header>
			<Card.Content className="flex flex-1 flex-col gap-2 p-0 pt-2">
				{status === "ready" ? (
					<>
						<div className="flex gap-2">
							<ResourceTile
								label={t("skills")}
								value={skillCount}
								onPress={() => openResource("skills")}
							/>
							<ResourceTile
								label={t("mcp")}
								value={mcpCount}
								onPress={() => openResource("mcp")}
							/>
						</div>
						{(showQuota || showStats) && (
							<div className="flex flex-col gap-1.5">
								{showQuota && (
									<QuotaRow
										windows={view.windows}
										alertThresholdPct={
											usageDisplay.alertThresholdPct
										}
									/>
								)}
								{showStats && (
									<div className="grid grid-cols-2 gap-x-3 gap-y-1">
										{statCellList.map(({ key, cell }) =>
											cell ? (
												<div
													key={key}
													className="flex items-baseline justify-between gap-1 text-[11px]"
												>
													<span className="text-muted">
														{t(cell.labelKey)}
													</span>
													<span className="text-foreground tabular-nums">
														{cell.value}
													</span>
												</div>
											) : (
												// Empty slot — hold the 2×2 position.
												<div key={key} aria-hidden />
											),
										)}
									</div>
								)}
							</div>
						)}
					</>
				) : (
					<p className="text-xs text-muted">
						{status === "missing"
							? t("agentMissingHint")
							: t("agentDisabledHint")}
					</p>
				)}
			</Card.Content>
		</Card>
	);
}

function ResourceTile({
	label,
	value,
	onPress,
}: {
	label: string;
	value: number;
	onPress: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onPress}
			className={cn(
				"group/tile relative flex flex-1 items-center justify-center rounded-md border border-border py-2 pr-8 pl-3 transition-colors dark:border-foreground/15",
				"hover:border-accent/40 hover:bg-accent/10 focus-visible:border-accent/40 focus-visible:bg-accent/10 focus-visible:outline-none",
			)}
		>
			<span className="text-xs text-muted transition-colors group-hover/tile:text-foreground group-focus-visible/tile:text-foreground">
				{label}
			</span>
			<span className="pl-1.5 text-sm font-medium text-foreground tabular-nums">
				{value}
			</span>
			<span
				aria-hidden
				className="pointer-events-none absolute right-2.5 flex size-4 translate-x-1 items-center justify-center text-accent opacity-0 transition-[opacity,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] group-hover/tile:translate-x-0 group-hover/tile:opacity-100 group-focus-visible/tile:translate-x-0 group-focus-visible/tile:opacity-100 motion-reduce:translate-x-0 motion-reduce:transition-none"
			>
				<ArrowRightIcon className="size-3.5" />
			</span>
		</button>
	);
}

function QuotaRow({
	windows,
	alertThresholdPct,
}: {
	windows: LimitWindowDto[];
	alertThresholdPct: number;
}) {
	const { t } = useTranslation();
	return (
		<div className="flex flex-col gap-1.5">
			{windows.map((quota) => {
				const pct = clampPct(quota.utilization_pct);
				const label = t(quotaWindowLabelKey(quota.kind));
				return (
					<div key={quota.kind} className="flex flex-col gap-0.5">
						<div className="flex items-baseline justify-between text-[11px]">
							<span className="text-muted">{label}</span>
							<span className="font-medium tabular-nums">
								{Math.round(pct)}%
							</span>
						</div>
						<Meter
							aria-label={label}
							value={pct}
							color={meterColor(pct, alertThresholdPct)}
							size="sm"
						>
							<Meter.Track>
								<Meter.Fill />
							</Meter.Track>
						</Meter>
					</div>
				);
			})}
		</div>
	);
}

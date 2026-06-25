import { ArrowRightIcon, FolderOpenIcon } from "@heroicons/react/24/solid";
import { Button, Card, Chip, Meter, toast, Tooltip } from "@heroui/react";
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
import { type AgentStatus, agentStatus } from "../lib/agent-status";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";
import { clampPct, meterColor, quotaWindowLabelKey } from "../lib/usage-format";
import { buildUsage } from "./agent-overview-card-helpers";

interface AgentOverviewCardProps {
	agent: AvailableAgent;
	skillCount: number;
	mcpCount: number;
	/** Consumed tokens/cost for this agent, when the usage backend reports it. */
	usage?: AgentUsageDto;
	/** Remaining rate-limit windows for this agent, when available. */
	limits?: AgentLimitsDto;
}

export function AgentOverviewCard({
	agent,
	skillCount,
	mcpCount,
	usage,
	limits,
}: AgentOverviewCardProps) {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const { data: configPath } = useAgentConfigPath(agent);
	const status = agentStatus(agent);
	const view = buildUsage({ usage, limits });

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

	const tall = view.primaryWindow != null || view.tokens != null;

	return (
		<Card
			variant="secondary"
			className={cn(
				"flex h-full flex-col gap-0 overflow-hidden p-3",
				tall ? "row-span-2" : "row-span-1",
			)}
		>
			<Card.Header className="flex flex-row items-center gap-2 p-0">
				<AgentIcon id={agent.id} name={agent.display_name} size="xs" />
				<Card.Title className="min-w-0 flex-1 truncate text-sm font-medium">
					{agent.display_name}
				</Card.Title>
				<AgentStatusChip status={status} />
				{configPath && (
					<Tooltip>
						<Tooltip.Trigger>
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
						</Tooltip.Trigger>
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
						{(view.primaryWindow || view.tokens) && (
							<div className="flex flex-col gap-2 border-t border-border pt-2">
								{view.primaryWindow && (
									<QuotaRow windows={view.windows} />
								)}
								{view.tokens && (
									<p className="text-xs text-muted">
										<span className="text-foreground tabular-nums">
											{view.tokens}
										</span>{" "}
										{t("usageTokensShort")}
										{view.cost && (
											<>
												{" · "}
												<span className="text-foreground tabular-nums">
													{view.cost}
												</span>
											</>
										)}
									</p>
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
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onPress}
			className={cn(
				"group/tile flex flex-1 items-center justify-center rounded-full border border-border px-3 py-2 transition-colors",
				"hover:border-accent hover:bg-accent focus-visible:border-accent focus-visible:bg-accent focus-visible:outline-none",
			)}
		>
			<span className="text-xs text-muted transition-colors group-hover/tile:text-accent-foreground group-focus-visible/tile:text-accent-foreground">
				{label}
			</span>
			<span className="pl-1.5 text-sm font-medium text-foreground tabular-nums transition-colors group-hover/tile:text-accent-foreground group-focus-visible/tile:text-accent-foreground">
				{value}
			</span>
			<span className="flex max-w-0 items-center gap-0.5 overflow-hidden pl-1.5 text-accent-foreground whitespace-nowrap opacity-0 transition-all duration-200 group-hover/tile:max-w-20 group-hover/tile:opacity-100 group-focus-visible/tile:max-w-20 group-focus-visible/tile:opacity-100">
				<span className="text-xs">{t("open")}</span>
				<ArrowRightIcon className="size-3.5" />
			</span>
		</button>
	);
}

function AgentStatusChip({ status }: { status: AgentStatus }) {
	const { t } = useTranslation();
	const color =
		status === "ready"
			? "success"
			: status === "missing"
				? "warning"
				: "default";
	const labelKey =
		status === "ready"
			? "agentStatusReady"
			: status === "missing"
				? "agentStatusMissing"
				: "agentStatusDisabled";
	return (
		<Chip color={color} variant="soft" size="sm">
			<span className="size-1.5 rounded-full bg-current" />
			<Chip.Label>{t(labelKey)}</Chip.Label>
		</Chip>
	);
}

function QuotaRow({ windows }: { windows: LimitWindowDto[] }) {
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
							color={meterColor(pct)}
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

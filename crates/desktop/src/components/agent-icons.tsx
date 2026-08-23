import { Tooltip } from "@heroui/react";
import { useMemo } from "react";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { AgentIcon } from "../lib/agent-icons";
import {
	cn,
	filterItemsByAgentIds,
	formatAgentName,
	sortAgents,
} from "../lib/utils";

interface AgentIconsProps<T extends { agent?: string | null }> {
	items: T[];
	overflowVariant?: "circle" | "square";
}

export function AgentIcons<T extends { agent?: string | null }>({
	items,
	overflowVariant = "circle",
}: AgentIconsProps<T>) {
	const { allAgents, availableAgents } = useAgentAvailability();
	const enabledAgentIds = useMemo(
		() =>
			new Set(
				availableAgents
					.filter((agent) => !agent.isDisabled)
					.map((agent) => agent.id),
			),
		[availableAgents],
	);
	const agents = useMemo(() => {
		const set = new Set<string>();
		for (const item of filterItemsByAgentIds(items, enabledAgentIds)) {
			if (item.agent) set.add(item.agent);
		}
		return sortAgents(Array.from(set), allAgents);
	}, [items, enabledAgentIds, allAgents]);

	if (agents.length === 0) {
		return null;
	}

	return (
		<div className="flex shrink-0 items-center -space-x-1">
			<span className="sr-only">
				{agents.map(formatAgentName).join(", ")}
			</span>
			{agents.slice(0, 3).map((agentId, idx) => (
				<Tooltip key={agentId} delay={0}>
					<Tooltip.Trigger>
						<div
							aria-hidden
							className="relative rounded-full bg-surface ring-1 ring-surface"
							style={{ zIndex: 3 - idx }}
						>
							<AgentIcon
								id={agentId}
								name={formatAgentName(agentId)}
								size="xs"
								variant="ghost"
							/>
						</div>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{formatAgentName(agentId)}
					</Tooltip.Content>
				</Tooltip>
			))}
			{agents.length > 3 && (
				<div
					aria-hidden
					className={cn(
						"relative z-0 flex size-5 items-center justify-center bg-default text-[10px] font-medium text-muted ring-1 ring-surface",
						overflowVariant === "circle"
							? "rounded-full"
							: "rounded-lg",
					)}
				>
					+{agents.length - 3}
				</div>
			)}
		</div>
	);
}

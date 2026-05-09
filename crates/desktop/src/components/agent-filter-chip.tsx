import { XMarkIcon } from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { AgentIcon } from "../lib/agent-icons";
import { cn } from "../lib/utils";

interface AgentFilterChipProps {
	agentId: string | null;
	onClear: () => void;
	className?: string;
}

/**
 * Compact chip rendered above a resource list when the user has filtered
 * by a specific agent. Shows the agent's icon + display name and an ✕
 * to clear the filter. Hidden when `agentId` is null.
 */
export function AgentFilterChip({
	agentId,
	onClear,
	className,
}: AgentFilterChipProps) {
	const { t } = useTranslation();
	const { availableAgents } = useAgentAvailability();

	if (!agentId) return null;

	const agent = availableAgents.find((a) => a.id === agentId);
	const displayName = agent?.display_name ?? agentId;

	return (
		<div
			className={cn(
				"flex items-center gap-2 border-b border-border bg-surface-secondary px-4 py-2 text-sm",
				className,
			)}
		>
			<span className="text-muted">{t("filteringByAgent")}</span>
			<span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5">
				<AgentIcon
					id={agentId}
					name={displayName}
					size="xs"
					variant="ghost"
				/>
				<span className="font-medium">{displayName}</span>
				<button
					type="button"
					onClick={onClear}
					aria-label={t("clearAgentFilter")}
					className="rounded-full p-0.5 text-muted transition-colors hover:bg-surface-secondary hover:text-foreground focus:bg-surface-secondary focus:outline-none"
				>
					<XMarkIcon className="size-3.5" />
				</button>
			</span>
		</div>
	);
}

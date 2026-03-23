import { Card, Switch } from "@heroui/react";
import { AgentIcon } from "../lib/agent-icons";
import type { AvailableAgent } from "../providers/agent-availability";

interface AgentCardProps {
	agent: AvailableAgent;
	isUpdating: boolean;
	onToggle: (agentId: string, currentlyDisabled: boolean) => void;
}

export function AgentCard({ agent, isUpdating, onToggle }: AgentCardProps) {
	const isDisabled = !agent.availability.is_available;

	return (
		<Card variant="default" className={`${isDisabled ? "opacity-50" : ""}`}>
			<Card.Content className="p-3">
				<div className="flex items-center gap-3">
					{/* Icon */}
					<AgentIcon id={agent.id} name={agent.display_name} />

					{/* Name */}
					<div className="flex-1 min-w-0">
						<div className="font-medium text-foreground truncate">
							{agent.display_name}
						</div>
					</div>

					{/* Toggle Switch */}
					<Switch
						isSelected={!agent.isDisabled}
						onChange={() => onToggle(agent.id, agent.isDisabled)}
						isDisabled={isDisabled || isUpdating}
						aria-label={`Toggle ${agent.display_name}`}
					/>
				</div>
			</Card.Content>
		</Card>
	);
}
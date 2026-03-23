import { Card, Switch } from "@heroui/react";
import { AgentIcon } from "../lib/agent-icons";
import type { AvailableAgent } from "../providers/agent-availability";

interface AgentCardProps {
	agent: AvailableAgent;
	isUpdating: boolean;
	onToggle: (agentId: string, currentlyDisabled: boolean) => void;
}

export function AgentCard({ agent, isUpdating, onToggle }: AgentCardProps) {
	const { has_global_directory, has_cli } = agent.availability;

	const sources: string[] = [];
	if (has_global_directory) sources.push("global config");
	if (has_cli) sources.push("cli");

	return (
		<Card>
			<Card.Header>
				<AgentIcon id={agent.id} name={agent.display_name} />
				<div className="flex-1 min-w-0">
					<Card.Title>{agent.display_name}</Card.Title>
					{sources.length > 0 && (
						<Card.Description>
							{sources.join(" / ")} found
						</Card.Description>
					)}
				</div>
				<Switch
					isSelected={!agent.isDisabled}
					onChange={() => onToggle(agent.id, agent.isDisabled)}
					isDisabled={isUpdating}
					aria-label={`Toggle ${agent.display_name}`}
				>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
				</Switch>
			</Card.Header>
		</Card>
	);
}

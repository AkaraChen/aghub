import { Card, Switch } from "@heroui/react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "../lib/agent-icons";
import type { AvailableAgent } from "../contexts/agent-availability";

interface AgentCardProps {
	agent: AvailableAgent;
	isUpdating: boolean;
	onToggle: (agentId: string, currentlyDisabled: boolean) => void;
}

export function AgentCard({ agent, isUpdating, onToggle }: AgentCardProps) {
	const { t } = useTranslation();
	const { has_global_directory, has_cli } = agent.availability;

	const sources: string[] = [];
	if (has_global_directory) sources.push(t("globalConfig"));
	if (has_cli) sources.push(t("cli"));

	return (
		<Card
			className={clsx(agent.isDisabled && "opacity-50")}
			variant="transparent"
		>
			<Card.Content className="flex flex-row items-center gap-3">
				<AgentIcon id={agent.id} name={agent.display_name} />
				<div className="min-w-0 flex-1">
					<Card.Title>{agent.display_name}</Card.Title>
					{sources.length > 0 && (
						<Card.Description>
							{t("detectedVia", { sources: sources.join(" / ") })}
						</Card.Description>
					)}
				</div>
				<Switch
					isSelected={!agent.isDisabled}
					onChange={() => onToggle(agent.id, agent.isDisabled)}
					isDisabled={isUpdating}
					aria-label={t("toggleAgent", { name: agent.display_name })}
				>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
				</Switch>
			</Card.Content>
		</Card>
	);
}

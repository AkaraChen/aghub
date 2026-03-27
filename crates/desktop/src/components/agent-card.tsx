import { Card, Switch, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { AvailableAgent } from "../contexts/agent-availability";
import { AgentIcon } from "../lib/agent-icons";

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

	const capabilityLabels: string[] = [];
	if (agent.capabilities.skills) capabilityLabels.push(t("skills"));
	if (agent.capabilities.mcp_stdio || agent.capabilities.mcp_remote)
		capabilityLabels.push(t("mcpServers"));

	return (
		<Tooltip delay={500}>
			<Card
				className="bg-surface transition-all duration-200"
				variant="transparent"
			>
				<Card.Content className="flex flex-row items-center gap-3">
					<AgentIcon id={agent.id} name={agent.display_name} />
					<div className="min-w-0 flex-1">
						<Card.Title>{agent.display_name}</Card.Title>
						{sources.length > 0 && (
							<Card.Description>
								{t("detectedVia", {
									sources: sources.join(" / "),
								})}
							</Card.Description>
						)}
					</div>
					<Tooltip>
						<Switch
							isSelected={!agent.isDisabled}
							onChange={() =>
								onToggle(agent.id, agent.isDisabled)
							}
							isDisabled={isUpdating}
							aria-label={t("toggleAgent", {
								name: agent.display_name,
							})}
						>
							<Switch.Control>
								<Switch.Thumb />
							</Switch.Control>
						</Switch>
						<Tooltip.Content>
							{agent.isDisabled
								? t("enableAgentTooltip", {
										name: agent.display_name,
									})
								: t("disableAgentTooltip", {
										name: agent.display_name,
									})}
						</Tooltip.Content>
					</Tooltip>
				</Card.Content>
			</Card>
			<Tooltip.Content>
				<div className="space-y-1 py-1">
					<p className="font-medium">{agent.display_name}</p>
					{capabilityLabels.length > 0 && (
						<p className="text-xs opacity-80">
							{t("supports")}: {capabilityLabels.join(", ")}
						</p>
					)}
				</div>
			</Tooltip.Content>
		</Tooltip>
	);
}

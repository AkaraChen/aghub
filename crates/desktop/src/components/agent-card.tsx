import { Card, Switch, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { AvailableAgent } from "../contexts/agent-availability";
import { supportsMcp, supportsSkill } from "../lib/agent-capabilities";
import { AgentIcon } from "../lib/agent-icons";

interface AgentCardProps {
	agent: AvailableAgent;
	isUpdating: boolean;
	onToggle: (agentId: string, currentlyDisabled: boolean) => void;
}

export function AgentCard({ agent, isUpdating, onToggle }: AgentCardProps) {
	const { t } = useTranslation();
	const surfaceLabel = (kind: (typeof agent.surfaces)[number]["kind"]) => {
		switch (kind) {
			case "cli":
				return t("cli");
			case "ide":
				return t("ide");
			case "desktop":
				return t("desktop");
			case "cloud":
				return t("cloud");
			case "remote_workspace":
				return t("remoteWorkspace");
		}
	};
	const sources = agent.availability.surfaces
		.filter((surface) => surface.state === "detected")
		.map((surface) => surfaceLabel(surface.kind));
	const uniqueSources = [...new Set(sources)];
	const statusText =
		agent.availability.state === "detected"
			? t("detectedVia", { sources: uniqueSources.join(" / ") })
			: agent.availability.configured
				? t("configurationFoundRuntimeUnknown")
				: agent.availability.state === "error"
					? t("detectionFailedCanPrepare")
					: agent.availability.state === "unknown"
						? t("detectionUnknownCanPrepare")
						: t("configurationCanBePrepared");

	const capabilityLabels: string[] = [];
	if (supportsSkill(agent)) capabilityLabels.push(t("skills"));
	if (supportsMcp(agent)) capabilityLabels.push(t("mcpServers"));

	return (
		<Tooltip delay={500}>
			<Card variant="secondary">
				<Card.Content className="flex flex-row items-center gap-3">
					<AgentIcon id={agent.id} name={agent.display_name} />
					<div className="min-w-0 flex-1">
						<Card.Title>{agent.display_name}</Card.Title>
						<Card.Description>{statusText}</Card.Description>
					</div>
					<Tooltip>
						<Tooltip.Trigger>
							<span className="inline-flex">
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
									<Switch.Content>
										<Switch.Control>
											<Switch.Thumb />
										</Switch.Control>
									</Switch.Content>
								</Switch>
							</span>
						</Tooltip.Trigger>
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

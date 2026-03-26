import { UserGroupIcon } from "@heroicons/react/24/solid";
import {
	Card,
	SearchField,
	ToggleButton,
	ToggleButtonGroup,
} from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentCard } from "../../components/agent-card";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { disableAgent, enableAgent } from "../../lib/store";

export default function AgentsPanel() {
	const { t } = useTranslation();
	const { availableAgents, refreshDisabledAgents } = useAgentAvailability();
	const [updating, setUpdating] = useState<string | null>(null);
	const [agentFilter, setAgentFilter] = useState<
		"all" | "enabled" | "disabled"
	>("all");
	const [agentSearch, setAgentSearch] = useState("");

	const handleToggleAgent = async (
		agentId: string,
		currentlyDisabled: boolean,
	) => {
		setUpdating(agentId);
		try {
			if (currentlyDisabled) {
				await enableAgent(agentId);
			} else {
				await disableAgent(agentId);
			}
			await refreshDisabledAgents();
		} finally {
			setUpdating(null);
		}
	};

	let filteredAgents = availableAgents.filter(
		(agent) => agent.availability.is_available,
	);

	// Apply search filter
	if (agentSearch.trim()) {
		const search = agentSearch.toLowerCase();
		filteredAgents = filteredAgents.filter(
			(agent) =>
				agent.display_name.toLowerCase().includes(search) ||
				agent.id.toLowerCase().includes(search),
		);
	}

	// Apply status filter
	if (agentFilter === "enabled") {
		filteredAgents = filteredAgents.filter((agent) => !agent.isDisabled);
	} else if (agentFilter === "disabled") {
		filteredAgents = filteredAgents.filter((agent) => agent.isDisabled);
	}

	return (
		<div className="space-y-3">
			{/* Search and Filter Bar */}
			<div
				className="
      flex flex-col gap-2
      sm:flex-row sm:items-center sm:justify-between
    "
			>
				<SearchField
					value={agentSearch}
					onChange={setAgentSearch}
					className="
       w-full
       sm:w-64
     "
				>
					<SearchField.Group>
						<SearchField.SearchIcon />
						<SearchField.Input placeholder={t("searchAgents")} />
						<SearchField.ClearButton />
					</SearchField.Group>
				</SearchField>
				<ToggleButtonGroup
					selectedKeys={[agentFilter]}
					onSelectionChange={(keys) =>
						setAgentFilter(
							[...keys][0] as "all" | "enabled" | "disabled",
						)
					}
					selectionMode="single"
					disallowEmptySelection
					size="sm"
				>
					<ToggleButton
						id="all"
						variant="ghost"
						className={"bg-surface"}
					>
						{t("all")}
					</ToggleButton>
					<ToggleButtonGroup.Separator />
					<ToggleButton
						id="enabled"
						variant="ghost"
						className={"bg-surface"}
					>
						{t("enabled")}
					</ToggleButton>
					<ToggleButtonGroup.Separator />
					<ToggleButton
						id="disabled"
						variant="ghost"
						className={"bg-surface"}
					>
						{t("disabled")}
					</ToggleButton>
				</ToggleButtonGroup>
			</div>

			{/* Agents Card */}
			<Card className="bg-surface" variant="transparent">
				<Card.Content>
					{filteredAgents.length === 0 ? (
						<div
							className="
              flex flex-col items-center justify-center py-16
              text-center
            "
						>
							<div className="mb-4 text-muted">
								<UserGroupIcon className="mx-auto size-12" />
							</div>
							<p className="text-sm font-medium text-(--foreground)">
								{agentSearch || agentFilter !== "all"
									? t("noAgentsMatch")
									: t("noAgentsAvailable")}
							</p>
							<p className="mt-1 max-w-sm text-xs text-muted">
								{agentSearch || agentFilter !== "all"
									? t("adjustFiltersDescription")
									: t("noAgentsDescription")}
							</p>
						</div>
					) : (
						<div
							className="
              grid grid-cols-1 gap-3
              sm:grid-cols-2
            "
						>
							{filteredAgents.map((agent) => (
								<AgentCard
									key={agent.id}
									agent={agent}
									isUpdating={updating === agent.id}
									onToggle={handleToggleAgent}
								/>
							))}
						</div>
					)}
				</Card.Content>
			</Card>
		</div>
	);
}

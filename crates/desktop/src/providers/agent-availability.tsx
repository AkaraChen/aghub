import { Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type {
	AgentAvailabilityProviderProps,
	AvailableAgent,
	AgentAvailabilityContextValue} from "../contexts/agent-availability";
import {
	AgentAvailabilityContext
} from "../contexts/agent-availability";
import type { AgentAvailability, AgentInfo } from "../lib/api";
import { createApi } from "../lib/api";
import { getDisabledAgents } from "../lib/store";
import { useServerContext } from "../contexts/server";

export function AgentAvailabilityProvider({
	children,
}: AgentAvailabilityProviderProps) {
	const { baseUrl } = useServerContext();
	const api = createApi(baseUrl);
	const [disabledAgents, setDisabledAgents] = useState<Set<string>>(
		new Set(),
	);

	// Fetch all agents
	const {
		data: allAgents = [],
		isLoading: isLoadingAgents,
		refetch: refetchAgents,
	} = useQuery({
		queryKey: ["agents"],
		queryFn: () => api.agents.list(),
	});

	// Fetch availability
	const {
		data: availabilityData = [],
		isLoading: isLoadingAvailability,
		refetch: refetchAvailability,
	} = useQuery({
		queryKey: ["agents-availability"],
		queryFn: () => api.agents.availability(),
	});

	// Load disabled agents from store
	useEffect(() => {
		getDisabledAgents().then((disabled: string[]) => {
			setDisabledAgents(new Set(disabled));
		});
	}, []);

	// Function to refresh disabled agents from store
	const refreshDisabledAgents = async () => {
		const disabled = await getDisabledAgents();
		setDisabledAgents(new Set(disabled));
	};

	// Combine data
	const availableAgents: AvailableAgent[] = allAgents.map(
		(agent: AgentInfo) => {
			const availability: AgentAvailability =
				availabilityData.find(
					(a: AgentAvailability) => a.id === agent.id,
				) ??
				({
					id: agent.id,
					has_global_directory: false,
					has_cli: false,
					is_available: false,
				} as AgentAvailability);

			const isDisabled = disabledAgents.has(agent.id);
			const isUsable = availability.is_available && !isDisabled;

			return {
				...agent,
				availability,
				isDisabled,
				isUsable,
			};
		},
	);

	const isLoading = isLoadingAgents || isLoadingAvailability;

	const refetch = () => {
		refetchAgents();
		refetchAvailability();
	};

	if (isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	const value: AgentAvailabilityContextValue = {
		availableAgents,
		allAgents,
		isLoading,
		refetch,
		refreshDisabledAgents,
	};

	return (
		<AgentAvailabilityContext value={value}>
			{children}
		</AgentAvailabilityContext>
	);
}

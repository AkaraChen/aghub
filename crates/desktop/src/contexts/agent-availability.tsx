import type { ReactNode } from "react";
import { createContext, use } from "react";
import type { AgentAvailability, AgentInfo } from "../lib/api";

export interface AvailableAgent extends AgentInfo {
	availability: AgentAvailability;
	isDisabled: boolean;
	isUsable: boolean;
}

export interface AgentAvailabilityContextValue {
	availableAgents: AvailableAgent[];
	allAgents: AgentInfo[];
	isLoading: boolean;
	refetch: () => void;
	refreshDisabledAgents: () => Promise<void>;
}

export const AgentAvailabilityContext = createContext<AgentAvailabilityContextValue | null>(null);

export function useAgentAvailabilityContext(): AgentAvailabilityContextValue {
	const ctx = use(AgentAvailabilityContext);
	if (!ctx)
		throw new Error(
			"useAgentAvailability must be used within <AgentAvailabilityProvider>",
		);
	return ctx;
}

export interface AgentAvailabilityProviderProps {
	children: ReactNode;
}

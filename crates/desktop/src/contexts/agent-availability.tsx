import type { ReactNode } from "react";
import { createContext } from "react";
import type { AgentAvailabilityDto, AgentInfo } from "../generated/dto";

export interface AvailableAgent extends AgentInfo {
	availability: AgentAvailabilityDto;
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

export const AgentAvailabilityContext =
	createContext<AgentAvailabilityContextValue | null>(null);

export interface AgentAvailabilityProviderProps {
	children: ReactNode;
}

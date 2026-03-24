import type { ReactNode } from "react";
import { createContext, use } from "react";

export interface ServerContextValue {
	port: number;
	baseUrl: string;
}

export const ServerContext = createContext<ServerContextValue | null>(null);

export function useServerContext(): ServerContextValue {
	const ctx = use(ServerContext);
	if (!ctx) throw new Error("useServer must be used within <ServerProvider>");
	return ctx;
}

export interface ServerProviderProps {
	children: ReactNode;
}

import { invoke } from "@tauri-apps/api/core";
import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";

export interface PostHogConfig {
	key: string | null;
	host: string;
	distinctId: string;
	sessionId: string;
}

export interface AppConfig {
	analyticsEnabled: boolean;
	appVersion: string;
	posthog: PostHogConfig;
}

type AppConfigUpdater = AppConfig | ((current: AppConfig) => AppConfig);

type AppConfigContextValue = {
	config: AppConfig;
	setConfig: (next: AppConfigUpdater) => Promise<AppConfig>;
};

const AppConfigContext = createContext<AppConfigContextValue | null>(null);

let currentAppConfig: AppConfig | null = null;

export function getCurrentAppConfig(): AppConfig | null {
	return currentAppConfig;
}

export async function loadAppConfig(): Promise<AppConfig> {
	const config = await invoke<AppConfig>("get_app_config");
	currentAppConfig = config;
	return config;
}

export async function persistAppConfig(config: AppConfig): Promise<AppConfig> {
	const saved = await invoke<AppConfig>("set_app_config", { config });
	currentAppConfig = saved;
	return saved;
}

export function AppConfigProvider({
	initialConfig,
	children,
}: {
	initialConfig: AppConfig;
	children: ReactNode;
}) {
	const [config, setConfigState] = useState(initialConfig);

	const value = useMemo<AppConfigContextValue>(
		() => ({
			config,
			setConfig: async (next: AppConfigUpdater) => {
				const resolved =
					typeof next === "function" ? next(currentAppConfig ?? config) : next;
				currentAppConfig = resolved;
				setConfigState(resolved);
				const saved = await persistAppConfig(resolved);
				setConfigState(saved);
				return saved;
			},
		}),
		[config],
	);

	return (
		<AppConfigContext.Provider value={value}>
			{children}
		</AppConfigContext.Provider>
	);
}

export function useAppConfig() {
	const value = useContext(AppConfigContext);
	if (!value) {
		throw new Error("useAppConfig must be used within AppConfigProvider");
	}
	return value;
}

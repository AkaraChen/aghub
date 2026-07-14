import { useQuery } from "@tanstack/react-query";
import { getUsageSettings } from "../lib/store";

/** Shared cache key for the persisted usage/ccusage preferences. */
export const USAGE_SETTINGS_QUERY_KEY = ["usage-settings"] as const;

/** Reads the usage/ccusage preferences from the Tauri store. */
export function useUsageSettings() {
	return useQuery({
		queryKey: USAGE_SETTINGS_QUERY_KEY,
		queryFn: getUsageSettings,
	});
}

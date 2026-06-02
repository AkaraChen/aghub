import { invoke } from "@tauri-apps/api/core";

export interface PosthogConfig {
	key: string | null;
	host: string | null;
}

let configPromise: Promise<PosthogConfig> | null = null;

export function getPosthogConfig(): Promise<PosthogConfig> {
	configPromise ??= invoke<PosthogConfig>("posthog_get_config").catch(
		(error) => {
			console.warn("[posthog] failed to load config", error);
			configPromise = null;
			return { key: null, host: null };
		},
	);
	return configPromise;
}

import type { Store } from "@tauri-apps/plugin-store";
import { DEFAULT_ONBOARDING_PROGRESS } from "../types";

export async function migrateV4ToV5(store: Store): Promise<void> {
	await store.set("onboardingProgress", DEFAULT_ONBOARDING_PROGRESS);
}

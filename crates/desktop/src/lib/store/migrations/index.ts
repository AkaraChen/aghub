import type { Store } from "@tauri-apps/plugin-store";
import { CURRENT_VERSION } from "../types";
import { initializeAutoCheckUpdates } from "./initialize-auto-check-updates";
import { initializeDisabledAgents } from "./initialize-disabled-agents";
import { initializeIntegrationPreferences } from "./initialize-integration-preferences";
import { initializeOnboardingProgress } from "./initialize-onboarding-progress";
import { initializeProjects } from "./initialize-projects";
import { initializeSidebarItems } from "./initialize-sidebar-items";
import { initializeSkillCopyCheck } from "./initialize-skill-copy-check";
import { initializeSkillAuditPreferences } from "./initialize-skill-audit-preferences";
import { initializeStarredResources } from "./initialize-starred-resources";
import { normalizeUpdateChannel } from "./normalize-update-channel";
import { resetSidebarItems } from "./reset-sidebar-items";
import { initializeSkillPreferences } from "./skill-preferences";

export async function migrate(store: Store): Promise<void> {
	const version = (await store.get<number>("version")) ?? 0;

	if (version === CURRENT_VERSION) return;

	if (version < 1) {
		await initializeProjects(store);
	}

	if (version < 2) {
		await initializeDisabledAgents(store);
	}

	if (version < 3) {
		await initializeIntegrationPreferences(store);
	}

	if (version < 4) {
		await initializeStarredResources(store);
	}

	if (version < 5) {
		await initializeOnboardingProgress(store);
	}

	if (version < 6) {
		await initializeSidebarItems(store);
	}

	if (version < 7) {
		await initializeAutoCheckUpdates(store);
	}

	if (version < 8) {
		await resetSidebarItems(store);
	}

	if (version < 9) {
		await normalizeUpdateChannel(store);
	}

	if (version < 10) {
		await initializeSkillAuditPreferences(store);
	}

	if (version < 11) {
		await initializeSkillCopyCheck(store);
	}

	if (version < 12) {
		await initializeSkillPreferences(store);
	}

	await store.set("version", CURRENT_VERSION);
	await store.save();
}

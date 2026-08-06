import type { Store } from "@tauri-apps/plugin-store";

type MigrationStore = Pick<Store, "get" | "set">;

export async function initializeSkillAuditPreferences(
	store: MigrationStore,
): Promise<void> {
	const assessments = await store.get<unknown>(
		"acknowledgedSkillAssessments",
	);
	if (!Array.isArray(assessments)) {
		await store.set("acknowledgedSkillAssessments", []);
	}

	const skillAuditEnabled = await store.get<unknown>("skillAuditEnabled");
	if (typeof skillAuditEnabled !== "boolean") {
		await store.set("skillAuditEnabled", true);
	}
}

import type { Store } from "@tauri-apps/plugin-store";

type MigrationStore = Pick<Store, "get" | "set">;

const DEFAULT_REPORT_RANGE = {
	mode: "last30",
	since: "",
	until: "",
};

export async function initializeUsageReportRange(
	store: MigrationStore,
): Promise<void> {
	const usageSettings = await store.get<unknown>("usageSettings");
	if (
		typeof usageSettings !== "object" ||
		usageSettings === null ||
		Array.isArray(usageSettings) ||
		"reportRange" in usageSettings
	) {
		return;
	}
	await store.set("usageSettings", {
		...usageSettings,
		reportRange: DEFAULT_REPORT_RANGE,
	});
}

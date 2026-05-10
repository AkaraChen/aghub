/**
 * Hand-authored release notes used by the upgrade wizard. Entries
 * are ordered newest first. The wizard surfaces every entry whose
 * `version` is strictly greater than the user's
 * `lastSeenWhatsNewVersion` from the Tauri store.
 *
 * Entries reference i18n keys instead of inlined strings so we can
 * translate them through the same pipeline the rest of the app
 * uses. `iconKey` is a string the wizard maps to a heroicon — see
 * the renderer in onboarding-controller.tsx for the supported set.
 *
 * For now this is a hand-curated mock list. If the cadence outgrows
 * a TypeScript array we can swap to a markdown-bundled or
 * remote-fetched source without changing the wizard's rendering.
 */

export interface WhatsNewItem {
	titleKey: string;
	descriptionKey: string;
	iconKey: "sparkles" | "puzzle" | "shield";
}

export interface WhatsNewEntry {
	version: string;
	titleKey: string;
	subtitleKey: string;
	items: WhatsNewItem[];
}

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
	{
		version: "0.2.0",
		titleKey: "whatsNewV02Title",
		subtitleKey: "whatsNewV02Subtitle",
		items: [
			{
				titleKey: "whatsNewV02PluginsTitle",
				descriptionKey: "whatsNewV02PluginsDescription",
				iconKey: "puzzle",
			},
			{
				titleKey: "whatsNewV02AnalyticsTitle",
				descriptionKey: "whatsNewV02AnalyticsDescription",
				iconKey: "shield",
			},
			{
				titleKey: "whatsNewV02PolishTitle",
				descriptionKey: "whatsNewV02PolishDescription",
				iconKey: "sparkles",
			},
		],
	},
] as const;

/**
 * Compare two semver-ish strings without pulling in a dep. Handles
 * the "x.y.z" shape we use; falls back to lexicographic comparison
 * for anything weirder so we never crash on a malformed entry.
 */
function compareVersions(a: string, b: string): number {
	const aParts = a.split(".").map(Number);
	const bParts = b.split(".").map(Number);
	if (aParts.some(Number.isNaN) || bParts.some(Number.isNaN)) {
		return a.localeCompare(b);
	}
	const len = Math.max(aParts.length, bParts.length);
	for (let i = 0; i < len; i++) {
		const ai = aParts[i] ?? 0;
		const bi = bParts[i] ?? 0;
		if (ai !== bi) return ai - bi;
	}
	return 0;
}

/**
 * Returns release entries the user hasn't acknowledged yet. When
 * `lastSeen` is null we treat the user as "first-time-seeing-notes"
 * and only surface the most recent entry — long-time users
 * upgrading shouldn't be blasted with months of historical notes.
 */
export function pendingWhatsNew(
	lastSeen: string | null,
	currentVersion: string,
): WhatsNewEntry[] {
	const sorted = [...WHATS_NEW_ENTRIES].sort((a, b) =>
		compareVersions(a.version, b.version),
	);
	if (lastSeen === null) {
		const newest = sorted[sorted.length - 1];
		return newest ? [newest] : [];
	}
	return sorted.filter(
		(entry) =>
			compareVersions(entry.version, lastSeen) > 0 &&
			compareVersions(entry.version, currentVersion) <= 0,
	);
}

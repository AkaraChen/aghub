import { compareVersions, validate } from "compare-versions";
import releaseCatalog from "../generated/release-notes.json";

export const WHATS_NEW_LOCALES = ["en", "zh-Hans", "zh-Hant"] as const;

export type WhatsNewLocale = (typeof WHATS_NEW_LOCALES)[number];
export type WhatsNewChannel = "stable" | "beta";
export type WhatsNewIcon = "sparkles" | "puzzle" | "shield";
export type LocalizedWhatsNewText = Record<WhatsNewLocale, string>;

export interface WhatsNewItem {
	id: string;
	icon: WhatsNewIcon;
	title: LocalizedWhatsNewText;
	description: LocalizedWhatsNewText;
}

export interface WhatsNewKnownIssue {
	id: string;
	title: LocalizedWhatsNewText;
	description: LocalizedWhatsNewText;
}

export interface WhatsNewEntry {
	version: string;
	channel: WhatsNewChannel;
	title: LocalizedWhatsNewText;
	summary: LocalizedWhatsNewText;
	highlights: WhatsNewItem[];
	knownIssues: WhatsNewKnownIssue[];
}

interface BundledReleaseCatalog {
	schemaVersion: 1;
	releases: WhatsNewEntry[];
}

export interface WhatsNewCopy {
	title: string;
	summary: string;
	highlights: Array<{
		id: string;
		icon: WhatsNewIcon;
		title: string;
		description: string;
	}>;
	knownIssues: Array<{
		id: string;
		title: string;
		description: string;
	}>;
}

const bundledCatalog = releaseCatalog as BundledReleaseCatalog;

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] =
	bundledCatalog.releases;

export function resolveWhatsNewLocale(
	language: string | undefined,
): WhatsNewLocale {
	if (language === "zh-Hans" || language === "zh-Hant") {
		return language;
	}
	const normalized = language?.toLowerCase();
	if (
		normalized?.includes("hant") ||
		normalized === "zh-tw" ||
		normalized === "zh-hk" ||
		normalized === "zh-mo"
	) {
		return "zh-Hant";
	}
	if (normalized?.startsWith("zh")) {
		return "zh-Hans";
	}
	return "en";
}

export function getWhatsNewCopy(
	entry: WhatsNewEntry,
	locale: WhatsNewLocale,
): WhatsNewCopy {
	return {
		title: entry.title[locale],
		summary: entry.summary[locale],
		highlights: entry.highlights.map((highlight) => ({
			id: highlight.id,
			icon: highlight.icon,
			title: highlight.title[locale],
			description: highlight.description[locale],
		})),
		knownIssues: entry.knownIssues.map((issue) => ({
			id: issue.id,
			title: issue.title[locale],
			description: issue.description[locale],
		})),
	};
}

export function pendingWhatsNew(
	lastSeen: string | null,
	currentVersion: string,
	entries: readonly WhatsNewEntry[],
): WhatsNewEntry[] {
	const stableBuild = !currentVersion.includes("-");
	const sorted = entries
		.filter(
			(entry) =>
				(!stableBuild || entry.channel === "stable") &&
				compareVersions(entry.version, currentVersion) <= 0,
		)
		.sort((left, right) => compareVersions(left.version, right.version));
	const watermark = lastSeen !== null && validate(lastSeen) ? lastSeen : null;
	if (watermark === null) {
		const newest = sorted[sorted.length - 1];
		return newest ? [newest] : [];
	}
	return sorted.filter(
		(entry) => compareVersions(entry.version, watermark) > 0,
	);
}

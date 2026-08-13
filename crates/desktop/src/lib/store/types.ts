import type { CodeEditorType } from "../../generated/dto";

export interface OnboardingProgress {
	hasSeenWelcome: boolean;
	completedTours: {
		productMap: boolean;
		projectWorkflow: boolean;
	};
}

export interface Project {
	id: string;
	name: string;
	path: string;
}

export interface IntegrationPreferences {
	codeEditor?: CodeEditorType;
}

export interface ResourceGroup {
	id: string;
	name: string;
}

export type UpdateChannel = "stable" | "beta";

export type SkillCopyCheckMode = "automatic" | "manual";

export interface SkillCopyCheckPreference {
	enabled: boolean;
	mode: SkillCopyCheckMode;
}

export const DEFAULT_SKILL_COPY_CHECK: SkillCopyCheckPreference = {
	enabled: true,
	mode: "automatic",
};

export type SkillStorageMode = "preserve" | "copy";

export interface SkillDiscoveryPreferences {
	projectSkills: boolean;
	embeddedSkills: boolean;
	dependencySkills: boolean;
}

export interface SkillPreferences extends SkillCopyCheckPreference {
	groupIdenticalCopies: boolean;
	warnOnConflicts: boolean;
	defaultStorageMode: SkillStorageMode;
	discovery: SkillDiscoveryPreferences;
}

export const DEFAULT_SKILL_PREFERENCES: SkillPreferences = {
	...DEFAULT_SKILL_COPY_CHECK,
	groupIdenticalCopies: true,
	warnOnConflicts: true,
	defaultStorageMode: "preserve",
	discovery: {
		projectSkills: true,
		embeddedSkills: true,
		dependencySkills: false,
	},
};

export function isSkillPreferences(value: unknown): value is SkillPreferences {
	if (!value || typeof value !== "object") return false;
	const preference = value as Partial<SkillPreferences>;
	return (
		typeof preference.enabled === "boolean" &&
		(preference.mode === "automatic" || preference.mode === "manual") &&
		typeof preference.groupIdenticalCopies === "boolean" &&
		typeof preference.warnOnConflicts === "boolean" &&
		(preference.defaultStorageMode === "preserve" ||
			preference.defaultStorageMode === "copy") &&
		Boolean(preference.discovery) &&
		typeof preference.discovery?.projectSkills === "boolean" &&
		typeof preference.discovery?.embeddedSkills === "boolean" &&
		typeof preference.discovery?.dependencySkills === "boolean"
	);
}

export const SIDEBAR_ITEM_IDS = [
	"home",
	"market",
	"usage",
	"skills",
	"mcp",
	"subAgents",
	"ccPlugins",
	"inferenceProviders",
] as const;

export type SidebarItemId = (typeof SIDEBAR_ITEM_IDS)[number];

export interface SidebarItemPreference {
	id: SidebarItemId;
	visible: boolean;
}

export const CURRENT_VERSION = 14;

export const DEFAULT_ONBOARDING_PROGRESS: OnboardingProgress = {
	hasSeenWelcome: false,
	completedTours: {
		productMap: false,
		projectWorkflow: false,
	},
};

export const DEFAULT_SIDEBAR_ITEMS: SidebarItemPreference[] =
	SIDEBAR_ITEM_IDS.map((id) => ({
		id,
		visible: true,
	}));

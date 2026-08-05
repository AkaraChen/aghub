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

export type SkillBaselineAgent = "claude" | "codex";

export interface SkillPreferences extends SkillCopyCheckPreference {
	groupIdenticalCopies: boolean;
	warnOnConflicts: boolean;
	baselineAgent: SkillBaselineAgent;
}

export const DEFAULT_SKILL_PREFERENCES: SkillPreferences = {
	...DEFAULT_SKILL_COPY_CHECK,
	groupIdenticalCopies: true,
	warnOnConflicts: true,
	baselineAgent: "claude",
};

export function isSkillPreferences(value: unknown): value is SkillPreferences {
	if (!value || typeof value !== "object") return false;
	const preference = value as Partial<SkillPreferences>;
	return (
		typeof preference.enabled === "boolean" &&
		(preference.mode === "automatic" || preference.mode === "manual") &&
		typeof preference.groupIdenticalCopies === "boolean" &&
		typeof preference.warnOnConflicts === "boolean" &&
		(preference.baselineAgent === "claude" ||
			preference.baselineAgent === "codex")
	);
}

export const SIDEBAR_ITEM_IDS = [
	"home",
	"market",
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

export const CURRENT_VERSION = 12;

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

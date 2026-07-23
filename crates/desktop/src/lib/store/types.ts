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

export const CURRENT_VERSION = 9;

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

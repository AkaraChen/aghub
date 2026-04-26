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

export const SIDEBAR_ITEM_IDS = [
	"mcp",
	"skills",
	"skillsSh",
	"subAgents",
	"plugins",
] as const;

export type SidebarItemId = (typeof SIDEBAR_ITEM_IDS)[number];

export interface SidebarItemPreference {
	id: SidebarItemId;
	visible: boolean;
}

export const CURRENT_VERSION = 6;

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

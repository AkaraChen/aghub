import { Store } from "@tauri-apps/plugin-store";
import type { CodeEditorType } from "./api-types";

const CURRENT_VERSION = 5;

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

interface IntegrationPreferences {
	codeEditor?: CodeEditorType;
}

const DEFAULT_ONBOARDING_PROGRESS: OnboardingProgress = {
	hasSeenWelcome: false,
	completedTours: {
		productMap: false,
		projectWorkflow: false,
	},
};

let store: Store | null = null;

function normalizeOnboardingProgress(
	value: Partial<OnboardingProgress> | null | undefined,
): OnboardingProgress {
	return {
		hasSeenWelcome: value?.hasSeenWelcome ?? false,
		completedTours: {
			productMap:
				value?.completedTours?.productMap ??
				DEFAULT_ONBOARDING_PROGRESS.completedTours.productMap,
			projectWorkflow:
				value?.completedTours?.projectWorkflow ??
				DEFAULT_ONBOARDING_PROGRESS.completedTours.projectWorkflow,
		},
	};
}

async function getStore(): Promise<Store> {
	if (!store) {
		store = await Store.load("store.json");
	}
	return store;
}

async function migrate(store: Store): Promise<void> {
	const version = (await store.get<number>("version")) ?? 0;

	if (version === CURRENT_VERSION) return;

	// Migration v0 -> v1: initial schema
	if (version < 1) {
		await store.set("projects", []);
	}

	// Migration v1 -> v2: add disabledAgents
	if (version < 2) {
		await store.set("disabledAgents", []);
	}

	// Migration v2 -> v3: add integrationPreferences
	if (version < 3) {
		await store.set("integrationPreferences", {});
	}

	// Migration v3 -> v4: add starred items
	if (version < 4) {
		await store.set("starredSkills", []);
		await store.set("starredMcps", []);
	}

	// Migration v4 -> v5: add onboarding progress
	if (version < 5) {
		await store.set("onboardingProgress", DEFAULT_ONBOARDING_PROGRESS);
	}

	await store.set("version", CURRENT_VERSION);
	await store.save();
}

export async function initStore(): Promise<void> {
	const store = await getStore();
	await migrate(store);
}

export async function getProjects(): Promise<Project[]> {
	const store = await getStore();
	return (await store.get<Project[]>("projects")) ?? [];
}

export async function addProject(
	project: Omit<Project, "id">,
): Promise<Project> {
	const store = await getStore();
	const projects = await getProjects();
	const newProject: Project = {
		...project,
		id: crypto.randomUUID(),
	};
	await store.set("projects", [...projects, newProject]);
	await store.save();
	return newProject;
}

export async function removeProject(id: string): Promise<void> {
	const store = await getStore();
	const projects = await getProjects();
	await store.set(
		"projects",
		projects.filter((p) => p.id !== id),
	);
	await store.save();
}

// Disabled agents management
export async function getDisabledAgents(): Promise<string[]> {
	const store = await getStore();
	return (await store.get<string[]>("disabledAgents")) ?? [];
}

async function setDisabledAgents(agentIds: string[]): Promise<void> {
	const store = await getStore();
	await store.set("disabledAgents", agentIds);
	await store.save();
}

export async function disableAgent(agentId: string): Promise<void> {
	const disabled = await getDisabledAgents();
	if (!disabled.includes(agentId)) {
		await setDisabledAgents([...disabled, agentId]);
	}
}

export async function enableAgent(agentId: string): Promise<void> {
	const disabled = await getDisabledAgents();
	await setDisabledAgents(disabled.filter((id) => id !== agentId));
}

export async function getIntegrationPreferences(): Promise<IntegrationPreferences> {
	const store = await getStore();
	return (
		(await store.get<IntegrationPreferences>("integrationPreferences")) ??
		{}
	);
}

export async function saveIntegrationPreferences(
	preferences: IntegrationPreferences,
): Promise<void> {
	const store = await getStore();
	await store.set("integrationPreferences", preferences);
	await store.save();
}

export async function getStarredSkills(): Promise<string[]> {
	const store = await getStore();
	return (await store.get<string[]>("starredSkills")) ?? [];
}

export async function setStarredSkills(skills: string[]): Promise<void> {
	const store = await getStore();
	await store.set("starredSkills", skills);
	await store.save();
}

export async function getStarredMcps(): Promise<string[]> {
	const store = await getStore();
	return (await store.get<string[]>("starredMcps")) ?? [];
}

export async function setStarredMcps(mcps: string[]): Promise<void> {
	const store = await getStore();
	await store.set("starredMcps", mcps);
	await store.save();
}

export async function getOnboardingProgress(): Promise<OnboardingProgress> {
	const store = await getStore();
	const progress = await store.get<OnboardingProgress>("onboardingProgress");

	return normalizeOnboardingProgress(progress);
}

export async function saveOnboardingProgress(
	progress: Partial<OnboardingProgress>,
): Promise<OnboardingProgress> {
	const store = await getStore();
	const nextProgress = normalizeOnboardingProgress(progress);

	await store.set("onboardingProgress", nextProgress);
	await store.save();

	return nextProgress;
}

export async function updateOnboardingProgress(updates: {
	hasSeenWelcome?: boolean;
	completedTours?: Partial<OnboardingProgress["completedTours"]>;
}): Promise<OnboardingProgress> {
	const current = await getOnboardingProgress();

	return saveOnboardingProgress({
		...current,
		...updates,
		completedTours: {
			...current.completedTours,
			...updates.completedTours,
		},
	});
}

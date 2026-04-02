import { getStore } from ".";

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

import { getStore } from ".";
import type { Project } from "./types";

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

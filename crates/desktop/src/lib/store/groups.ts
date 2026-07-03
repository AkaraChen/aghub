import { getStore } from ".";
import type { ResourceGroup } from "./types";

export interface ResourceGroupStore {
	getGroups: () => Promise<ResourceGroup[]>;
	getAssignments: () => Promise<Record<string, string>>;
	createGroup: (name: string) => Promise<ResourceGroup>;
	renameGroup: (id: string, name: string) => Promise<void>;
	deleteGroup: (id: string) => Promise<void>;
	assignMember: (memberKey: string, groupId: string) => Promise<void>;
	unassignMember: (memberKey: string) => Promise<void>;
	migrateMember: (oldKey: string, newKey: string) => Promise<void>;
}

function createResourceGroupStore(
	groupsKey: string,
	assignmentsKey: string,
): ResourceGroupStore {
	const getGroups = async (): Promise<ResourceGroup[]> => {
		const store = await getStore();
		return (await store.get<ResourceGroup[]>(groupsKey)) ?? [];
	};

	const getAssignments = async (): Promise<Record<string, string>> => {
		const store = await getStore();
		return (await store.get<Record<string, string>>(assignmentsKey)) ?? {};
	};

	return {
		getGroups,
		getAssignments,
		async createGroup(name: string) {
			const store = await getStore();
			const groups = await getGroups();
			const group: ResourceGroup = { id: crypto.randomUUID(), name };
			await store.set(groupsKey, [...groups, group]);
			await store.save();
			return group;
		},
		async renameGroup(id: string, name: string) {
			const store = await getStore();
			const groups = await getGroups();
			await store.set(
				groupsKey,
				groups.map((g) => (g.id === id ? { ...g, name } : g)),
			);
			await store.save();
		},
		async deleteGroup(id: string) {
			const store = await getStore();
			const groups = await getGroups();
			const assignments = await getAssignments();
			const remaining = { ...assignments };
			for (const [memberKey, groupId] of Object.entries(remaining)) {
				if (groupId === id) delete remaining[memberKey];
			}
			await store.set(
				groupsKey,
				groups.filter((g) => g.id !== id),
			);
			await store.set(assignmentsKey, remaining);
			await store.save();
		},
		async assignMember(memberKey: string, groupId: string) {
			const store = await getStore();
			const assignments = await getAssignments();
			await store.set(assignmentsKey, {
				...assignments,
				[memberKey]: groupId,
			});
			await store.save();
		},
		async unassignMember(memberKey: string) {
			const store = await getStore();
			const assignments = await getAssignments();
			const remaining = { ...assignments };
			delete remaining[memberKey];
			await store.set(assignmentsKey, remaining);
			await store.save();
		},
		// Mirrors migrateStarredMcp: member keys derive from content
		// (mcp mergeKey), so an edit that changes the key must carry
		// the assignment over. No-op when the old key is unassigned;
		// an existing assignment on the new key wins.
		async migrateMember(oldKey: string, newKey: string) {
			const store = await getStore();
			const assignments = await getAssignments();
			const groupId = assignments[oldKey];
			if (groupId === undefined) return;
			const next = { ...assignments };
			delete next[oldKey];
			if (next[newKey] === undefined) next[newKey] = groupId;
			await store.set(assignmentsKey, next);
			await store.save();
		},
	};
}

export const skillGroupStore = createResourceGroupStore(
	"skillGroups",
	"skillGroupAssignments",
);

export const mcpGroupStore = createResourceGroupStore(
	"mcpGroups",
	"mcpGroupAssignments",
);

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ResourceGroupStore } from "../lib/store";
import { mcpGroupStore, skillGroupStore } from "../lib/store";
import { withViewTransition } from "../lib/view-transition";

const QUERY_KEYS = {
	skill: {
		groups: ["skillGroups"],
		assignments: ["skillGroupAssignments"],
	},
	mcp: {
		groups: ["mcpGroups"],
		assignments: ["mcpGroupAssignments"],
	},
} as const;

function useResourceGroups(
	kind: keyof typeof QUERY_KEYS,
	store: ResourceGroupStore,
) {
	const queryClient = useQueryClient();
	const keys = QUERY_KEYS[kind];

	const { data: groups = [] } = useQuery({
		queryKey: keys.groups,
		queryFn: store.getGroups,
	});

	const { data: assignments = {} } = useQuery({
		queryKey: keys.assignments,
		queryFn: store.getAssignments,
	});

	const invalidate = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: keys.groups }),
			queryClient.invalidateQueries({ queryKey: keys.assignments }),
		]);
	}, [queryClient, keys]);

	const createGroup = useCallback(
		async (name: string) => {
			const group = await store.createGroup(name);
			await invalidate();
			return group;
		},
		[store, invalidate],
	);

	const renameGroup = useCallback(
		async (id: string, name: string) => {
			await store.renameGroup(id, name);
			await invalidate();
		},
		[store, invalidate],
	);

	// Membership changes move rows between sections; a View Transition
	// slides items to their new home instead of teleporting (VT-1).
	const deleteGroup = useCallback(
		async (id: string) => {
			await withViewTransition(async () => {
				await store.deleteGroup(id);
				await invalidate();
			});
		},
		[store, invalidate],
	);

	const assignMembers = useCallback(
		async (memberKeys: string[], groupId: string) => {
			await withViewTransition(async () => {
				await store.assignMembers(memberKeys, groupId);
				await invalidate();
			});
		},
		[store, invalidate],
	);

	const unassignMembers = useCallback(
		async (memberKeys: string[]) => {
			await withViewTransition(async () => {
				await store.unassignMembers(memberKeys);
				await invalidate();
			});
		},
		[store, invalidate],
	);

	return {
		groups,
		assignments,
		createGroup,
		renameGroup,
		deleteGroup,
		assignMembers,
		unassignMembers,
	};
}

export function useSkillGroups() {
	return useResourceGroups("skill", skillGroupStore);
}

export function useMcpGroups() {
	return useResourceGroups("mcp", mcpGroupStore);
}

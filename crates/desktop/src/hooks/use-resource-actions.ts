import { useCallback, useMemo } from "react";
import type { ResourceGroup } from "../lib/store";
import { useFavorites } from "./use-favorites";
import { useMcpGroups, useSkillGroups } from "./use-resource-groups";

export type ResourceKind = "skill" | "mcp";

/**
 * Dialog-backed actions the host component owns: the action layer
 * signals intent, the host opens the matching dialog with the current
 * selection.
 */
export interface ResourceActionIntents {
	onRequestDelete: () => void;
	onRequestAddToAgent: () => void;
	onRequestTransfer: () => void;
	onRequestCreateGroup: () => void;
}

export interface ResourceActionsModel {
	/** Number of selected items the actions operate on */
	count: number;
	/** Whether file-backed actions may modify every selected item. */
	canWrite: boolean;
	/** True when every selected item is starred (drives label/behavior) */
	allStarred: boolean;
	toggleFavorite: () => Promise<void>;
	/** Groups for the move-to-group submenu */
	groups: ResourceGroup[];
	/** Group id shared by the whole selection, if any (menu check mark) */
	commonGroupId: string | null;
	canRemoveFromGroup: boolean;
	moveToGroup: (groupId: string) => Promise<void>;
	removeFromGroup: () => Promise<void>;
	requestDelete: () => void;
	requestAddToAgent: () => void;
	requestTransfer: () => void;
	requestCreateGroup: () => void;
}

/**
 * Shared action model for the resource lists. Every entry point —
 * context menu, bulk panel, drag and drop — renders or executes from
 * this one model, so single-item and multi-select behavior can never
 * drift apart. Local store actions (favorite, grouping) execute
 * directly; destructive or configurable ones raise intents.
 */
export function useResourceActions(options: {
	kind: ResourceKind;
	selectedKeys: Set<string>;
	intents: ResourceActionIntents;
	canWrite?: boolean;
}): ResourceActionsModel {
	const { kind, selectedKeys, intents, canWrite = true } = options;
	const { starredSkills, starredMcps, setSkillsStarred, setMcpsStarred } =
		useFavorites();
	const skillGroups = useSkillGroups();
	const mcpGroups = useMcpGroups();

	const groupsModel = kind === "skill" ? skillGroups : mcpGroups;
	const starredSet = kind === "skill" ? starredSkills : starredMcps;
	const setStarred = kind === "skill" ? setSkillsStarred : setMcpsStarred;

	const keys = useMemo(() => [...selectedKeys], [selectedKeys]);

	const allStarred =
		keys.length > 0 && keys.every((key) => starredSet.has(key));

	const toggleFavorite = useCallback(async () => {
		await setStarred(keys, !allStarred);
	}, [setStarred, keys, allStarred]);

	const commonGroupId = useMemo(() => {
		if (keys.length === 0) return null;
		const first = groupsModel.assignments[keys[0]] ?? null;
		if (!first) return null;
		return keys.every((key) => groupsModel.assignments[key] === first)
			? first
			: null;
	}, [keys, groupsModel.assignments]);

	const canRemoveFromGroup = useMemo(
		() => keys.some((key) => groupsModel.assignments[key] !== undefined),
		[keys, groupsModel.assignments],
	);

	const moveToGroup = useCallback(
		async (groupId: string) => {
			await groupsModel.assignMembers(keys, groupId);
		},
		[groupsModel, keys],
	);

	const removeFromGroup = useCallback(async () => {
		await groupsModel.unassignMembers(keys);
	}, [groupsModel, keys]);

	return {
		count: keys.length,
		canWrite,
		allStarred,
		toggleFavorite,
		groups: groupsModel.groups,
		commonGroupId,
		canRemoveFromGroup,
		moveToGroup,
		removeFromGroup,
		requestDelete: intents.onRequestDelete,
		requestAddToAgent: intents.onRequestAddToAgent,
		requestTransfer: intents.onRequestTransfer,
		requestCreateGroup: intents.onRequestCreateGroup,
	};
}

/**
 * Drop-target identity shared by the resource lists and the drop board.
 * The page owns a single DndContext; onDragEnd resolves an over-id to one
 * of these targets and runs the matching group mutation. The board reuses
 * the same targets under a `board:` prefix so a card and its list section
 * do not collide as two droppables with one id.
 */

export const UNGROUPED_DROP_ID = "ungrouped";
export const NEW_GROUP_DROP_ID = "new-group";
const GROUP_PREFIX = "group:";
const BOARD_PREFIX = "board:";

/**
 * The member keys a draggable carries. List items freeze theirs into a
 * ref (so a multi-selection is not collapsed out of the drag on press);
 * group headers pass a plain array.
 */
export type DragKeys = string[] | { current: string[] };

/** Reads the keys off a dnd-kit active draggable, ref or array. */
export function readActiveKeys(active: {
	data: { current?: { keys?: unknown } };
}): string[] {
	const raw = active.data.current?.keys;
	const keys =
		raw && typeof raw === "object" && "current" in raw
			? (raw as { current: unknown }).current
			: raw;
	if (Array.isArray(keys) && keys.every((k) => typeof k === "string")) {
		return keys;
	}
	return [];
}

export function groupDropId(groupId: string): string {
	return `${GROUP_PREFIX}${groupId}`;
}

export function boardDropId(id: string): string {
	return `${BOARD_PREFIX}${id}`;
}

/**
 * Post-drop confirmation: flashes the drop target once. Imperative on
 * purpose — a delayed setState here would re-render mid-press and could
 * swallow the next drag's activation.
 */
export function flashDropTarget(dropId: string): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const el = document.querySelector(`[data-drop-id="${CSS.escape(dropId)}"]`);
	if (el instanceof HTMLElement) {
		el.animate(
			[
				{
					backgroundColor:
						"color-mix(in oklab, var(--accent) 15%, transparent)",
				},
				{ backgroundColor: "transparent" },
			],
			{ duration: 500, easing: "ease-out" },
		);
	}
}

export type DropTarget =
	| { kind: "group"; groupId: string }
	| { kind: "ungrouped" }
	| { kind: "new-group" };

/**
 * Maps a dnd-kit over-id (from either the list or the board) to a target.
 * Returns null for ids that are not drop targets.
 */
export function parseDropTarget(overId: string): DropTarget | null {
	const id = overId.startsWith(BOARD_PREFIX)
		? overId.slice(BOARD_PREFIX.length)
		: overId;
	if (id === UNGROUPED_DROP_ID) return { kind: "ungrouped" };
	if (id === NEW_GROUP_DROP_ID) return { kind: "new-group" };
	if (id.startsWith(GROUP_PREFIX)) {
		return { kind: "group", groupId: id.slice(GROUP_PREFIX.length) };
	}
	return null;
}

export interface ResolveDropParams {
	overId: string | null;
	active: { data: { current?: { keys?: unknown } } };
	/** groupId a member already belongs to, for the self-drop no-op */
	assignments: Record<string, string>;
	assignMembers: (keys: string[], groupId: string) => void;
	unassignMembers: (keys: string[]) => void;
	createGroupWith: (keys: string[]) => void;
	/** Called with the affected keys when a drop actually mutates */
	onMutated?: (keys: string[], target: DropTarget) => void;
}

/**
 * Resolves a completed drag to its group mutation. A drop whose keys are
 * already all in the target group (or already ungrouped) is a no-op — no
 * mutation, no feedback.
 */
export function resolveDrop({
	overId,
	active,
	assignments,
	assignMembers,
	unassignMembers,
	createGroupWith,
	onMutated,
}: ResolveDropParams): void {
	if (!overId) return;
	const target = parseDropTarget(overId);
	if (!target) return;
	const keys = readActiveKeys(active);
	if (keys.length === 0) return;

	if (target.kind === "new-group") {
		createGroupWith(keys);
		onMutated?.(keys, target);
		return;
	}
	if (target.kind === "ungrouped") {
		if (keys.every((k) => assignments[k] === undefined)) return;
		unassignMembers(keys);
		onMutated?.(keys, target);
		return;
	}
	if (keys.every((k) => assignments[k] === target.groupId)) return;
	assignMembers(keys, target.groupId);
	onMutated?.(keys, target);
}

import {
	type DragEndEvent,
	type DragStartEvent,
	MeasuringStrategy,
	PointerSensor,
	pointerWithin,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";
import type { DropBoardGroup } from "../components/drop-board";
import { readActiveKeys, resolveDrop } from "../components/list-dnd";
import { useMcpGroups, useSkillGroups } from "./use-resource-groups";

/**
 * Page-level drag wiring for a resource list. Each surface owns one
 * DndContext (skill and mcp lists must not share one, or their `group:`
 * and `ungrouped` droppable ids collide). Returns the props to spread on
 * a DndContext plus the drag state a drop board needs.
 */
export function useListDnd(
	kind: "skill" | "mcp",
	onCreateGroupWith: (keys: string[]) => void,
) {
	const skillGroups = useSkillGroups();
	const mcpGroups = useMcpGroups();
	const model = kind === "skill" ? skillGroups : mcpGroups;

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
	);
	const [draggedKeys, setDraggedKeys] = useState<string[] | null>(null);

	const boardGroups = useMemo<DropBoardGroup[]>(
		() =>
			model.groups.map((group) => ({
				id: group.id,
				name: group.name,
				count: Object.values(model.assignments).filter(
					(id) => id === group.id,
				).length,
			})),
		[model.groups, model.assignments],
	);
	const showBoardUngrouped = (draggedKeys ?? []).some(
		(key) => model.assignments[key] !== undefined,
	);

	const dndProps = {
		sensors,
		collisionDetection: pointerWithin,
		// Re-measure droppables during the drag; the new-group zone appears
		// mid-drag and shifts the sections, so cached rects go stale.
		measuring: { droppable: { strategy: MeasuringStrategy.Always } },
		onDragStart: (event: DragStartEvent) => {
			setDraggedKeys(readActiveKeys(event.active));
		},
		onDragEnd: (event: DragEndEvent) => {
			resolveDrop({
				overId: event.over ? String(event.over.id) : null,
				active: event.active,
				assignments: model.assignments,
				assignMembers: model.assignMembers,
				unassignMembers: model.unassignMembers,
				createGroupWith: onCreateGroupWith,
			});
			setDraggedKeys(null);
		},
		onDragCancel: () => setDraggedKeys(null),
	};

	return { dndProps, draggedKeys, boardGroups, showBoardUngrouped };
}

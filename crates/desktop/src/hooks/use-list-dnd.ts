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
import {
	flashDropTarget,
	groupDropId,
	readActiveKeys,
	resolveDrop,
	UNGROUPED_DROP_ID,
} from "../components/list-dnd";
import { useMcpGroups, useSkillGroups } from "./use-resource-groups";

// Stable references: recreating these per render would re-register the
// sensor mid-press and drop a pending activation (a re-render between
// pointer-down and crossing the threshold, e.g. the flash timer, would
// silently kill the next drag).
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } };
// WhileDragging: measure on drag start; mid-drag mounts (drop board,
// new-group zone) are measured on registration. The one layout change
// neither strategy catches — a spring-loaded expansion shifting the
// sections below it — is re-measured explicitly by ResourceGroupSection
// on its height transitionend (e2e "dropping below a spring-opened
// group" covers it).
const MEASURING = { droppable: { strategy: MeasuringStrategy.WhileDragging } };

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
		useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
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
		measuring: MEASURING,
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
				onMutated: (_keys, target) => {
					if (target.kind === "group") {
						flashDropTarget(groupDropId(target.groupId));
					} else if (target.kind === "ungrouped") {
						flashDropTarget(UNGROUPED_DROP_ID);
					}
				},
			});
			setDraggedKeys(null);
		},
		onDragCancel: () => setDraggedKeys(null),
	};

	return { dndProps, draggedKeys, boardGroups, showBoardUngrouped };
}

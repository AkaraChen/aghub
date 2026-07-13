import { useDraggable } from "@dnd-kit/core";
import { type ReactNode, useRef } from "react";

interface DraggableItemBodyProps {
	/** Unique dnd-kit id for this row's draggable */
	dragId: string;
	/**
	 * Resolves the member keys the drag carries (self plus selection).
	 * Called on pointer-down, so the row's JSX never closes over the live
	 * selection — a selection change must not rebuild every row.
	 */
	getKeys: () => string[];
	onContextMenu: (event: React.MouseEvent) => void;
	/**
	 * A left shift-press on this row. react-stately swallows a shift-click
	 * on an already-selected row (the selection set is unchanged, so no
	 * event fires) — the list uses this to run the range selection itself.
	 * Returning the new drag payload refreezes it, so a shift-press that
	 * turns into a drag carries the range it just applied.
	 */
	onShiftPress?: () => string[] | undefined;
	children: ReactNode;
}

/**
 * The inner row of a ListBox.Item: draggable via dnd-kit, and stops a
 * right-press from reaching react-aria so onContextMenu owns the
 * selection. The pointer sensor ignores non-primary buttons, so a
 * right-click never starts a drag.
 *
 * The payload is frozen on pointer-down (which fires before react-aria's
 * bubbling press handler) so pressing an item that is part of a
 * multi-selection does not collapse the selection out of the drag before
 * dnd-kit reads it.
 */
export function DraggableItemBody({
	dragId,
	getKeys,
	onContextMenu,
	onShiftPress,
	children,
}: DraggableItemBodyProps) {
	const frozenKeysRef = useRef<string[]>([]);

	const { setNodeRef, listeners } = useDraggable({
		id: dragId,
		data: { keys: frozenKeysRef },
	});

	return (
		<div
			ref={setNodeRef}
			{...listeners}
			onPointerDown={(event) => {
				frozenKeysRef.current = getKeys();
				listeners?.onPointerDown?.(event);
				if (event.button === 2) event.stopPropagation();
				if (event.button === 0 && event.shiftKey) {
					const next = onShiftPress?.();
					if (next) frozenKeysRef.current = next;
				}
			}}
			onContextMenu={onContextMenu}
			className="flex w-full items-center gap-2"
		>
			{children}
		</div>
	);
}

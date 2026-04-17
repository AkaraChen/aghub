import { useCallback, useEffect, useRef } from "react";

export interface UseMultiSelectOptions<T extends string> {
	/** Currently selected keys */
	selectedKeys: Set<T>;
	/** Callback when selection changes */
	onSelectionChange: (keys: Set<T>, clickedKey?: T) => void;
	/** Whether multi-select mode is enabled */
	isMultiSelectMode?: boolean;
}

export interface UseMultiSelectReturn<T extends string> {
	/** Creates a handler for a specific ordered keys list */
	createSelectionHandler: (
		orderedKeys: T[],
	) => (keys: "all" | Set<React.Key>) => void;
}

/**
 * Hook for handling multi-select logic with shift+click and meta/ctrl+click support.
 *
 * Features:
 * - Shift+click: Select range from last clicked to current
 * - Meta/Ctrl+click: Toggle individual items
 * - Single click: Select single item (unless in multi-select mode)
 *
 * Returns a factory function `createSelectionHandler(orderedKeys)` that creates
 * selection handlers for different ordered key lists (useful when you have multiple
 * list boxes with different key ordering).
 */
export function useMultiSelect<T extends string>(
	options: UseMultiSelectOptions<T>,
): UseMultiSelectReturn<T> {
	const {
		selectedKeys,
		onSelectionChange,
		isMultiSelectMode = false,
	} = options;

	const modifiersRef = useRef({
		shift: false,
		meta: false,
	});
	const lastClickedRef = useRef<T | null>(null);

	useEffect(() => {
		const handler = (e: PointerEvent) => {
			modifiersRef.current = {
				shift: e.shiftKey,
				meta: e.metaKey || e.ctrlKey,
			};
		};
		window.addEventListener("pointerdown", handler, true);
		return () => window.removeEventListener("pointerdown", handler, true);
	}, []);

	const createSelectionHandler = useCallback(
		(orderedKeys: T[]) => (keys: "all" | Set<React.Key>) => {
			if (keys === "all") return;
			const newKeys = new Set(Array.from(keys).map(String) as T[]);
			const added = [...newKeys].find((k) => !selectedKeys.has(k));
			const removed = [...selectedKeys].find((k) => !newKeys.has(k));
			const clicked = (added ?? removed) as T | undefined;

			if (!clicked) {
				onSelectionChange(newKeys);
				return;
			}

			let finalKeys: Set<T>;

			if (modifiersRef.current.shift && lastClickedRef.current) {
				const start = orderedKeys.indexOf(lastClickedRef.current);
				const end = orderedKeys.indexOf(clicked);
				if (start !== -1 && end !== -1) {
					const [from, to] = [
						Math.min(start, end),
						Math.max(start, end),
					];
					finalKeys = new Set(orderedKeys.slice(from, to + 1));
				} else {
					finalKeys = new Set([...selectedKeys, clicked]);
				}
			} else if (!isMultiSelectMode && !modifiersRef.current.meta) {
				finalKeys = new Set([clicked]);
			} else {
				finalKeys = new Set(selectedKeys);
				if (finalKeys.has(clicked)) {
					finalKeys.delete(clicked);
				} else {
					finalKeys.add(clicked);
				}
			}

			if (!modifiersRef.current.shift) {
				lastClickedRef.current = clicked;
			}

			onSelectionChange(finalKeys, clicked);
		},
		[selectedKeys, onSelectionChange, isMultiSelectMode],
	);

	return { createSelectionHandler };
}

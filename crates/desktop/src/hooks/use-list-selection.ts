import { useCallback, useEffect, useRef } from "react";

export interface UseListSelectionOptions {
	/** All visible keys in display order, flattened across sections */
	orderedKeys: string[];
	/** Keys the list highlights, including any default-highlighted item */
	selectedKeys: Set<string>;
	/**
	 * The user's explicit selection, without the default-highlight
	 * fabrication. Toggle-off only fires when this holds exactly the
	 * clicked key, so clicking a merely default-highlighted item selects
	 * it instead of clearing. Defaults to selectedKeys.
	 */
	committedKeys?: Set<string>;
	/** Callback when selection changes */
	onSelectionChange: (keys: Set<string>, clickedKey?: string) => void;
	/** Whether multi-select mode is enabled */
	isMultiSelectMode?: boolean;
}

export interface UseListSelectionReturn {
	/**
	 * Creates an onSelectionChange handler for one ListBox section.
	 * sectionKeys scopes the click diff to that section; shift ranges
	 * span sections via the hook-level orderedKeys.
	 */
	createSelectionHandler: (
		sectionKeys: string[],
	) => (keys: "all" | Set<React.Key>) => void;
	/**
	 * Group-header click: plain click replaces the selection with the
	 * group members; meta/ctrl toggles the whole group in or out.
	 */
	selectGroup: (memberKeys: string[]) => void;
	/**
	 * Context-menu opening: keeps the selection if the key is already
	 * in it, otherwise resets the selection to that key (Finder
	 * semantics). Returns the selection the menu should act on.
	 */
	ensureSelected: (key: string) => Set<string>;
}

/**
 * Cross-section selection controller for the resource lists.
 *
 * Extends the former per-ListBox useMultiSelect with a list-wide key
 * order so shift+click ranges work across group sections, plus
 * group-header selection and context-menu targeting.
 */
export function useListSelection(
	options: UseListSelectionOptions,
): UseListSelectionReturn {
	const {
		orderedKeys,
		selectedKeys,
		committedKeys = selectedKeys,
		onSelectionChange,
		isMultiSelectMode = false,
	} = options;

	const modifiersRef = useRef({
		shift: false,
		meta: false,
	});
	const lastClickedRef = useRef<string | null>(null);

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
		(sectionKeys: string[]) => (keys: "all" | Set<React.Key>) => {
			if (keys === "all") return;
			const newKeys = new Set(Array.from(keys).map(String));
			const added = [...newKeys].find((k) => !selectedKeys.has(k));
			// A section only reports its own items, so restrict the
			// removal diff to this section or selections held by other
			// sections would masquerade as the clicked key.
			const removed = [...selectedKeys].find(
				(k) => sectionKeys.includes(k) && !newKeys.has(k),
			);
			const clicked = added ?? removed;

			if (!clicked) {
				onSelectionChange(newKeys);
				return;
			}

			let finalKeys: Set<string>;

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
					finalKeys = new Set([...committedKeys, clicked]);
				}
			} else if (!isMultiSelectMode && !modifiersRef.current.meta) {
				// A plain click that deselects the user's sole committed
				// selection clears it (click again to cancel); any other
				// plain click narrows the selection to just that item. A
				// merely default-highlighted item is not committed, so
				// clicking it selects rather than clears.
				const togglingOff =
					added === undefined &&
					committedKeys.size === 1 &&
					committedKeys.has(clicked);
				finalKeys = togglingOff ? new Set<string>() : new Set([clicked]);
			} else {
				// Toggle against the committed selection, not the effective
				// set — a default-highlighted item is not committed, so a
				// modifier-click on it (or on another item while it is the
				// phantom highlight) must not pull it into the selection.
				finalKeys = new Set(committedKeys);
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
		[
			orderedKeys,
			selectedKeys,
			committedKeys,
			onSelectionChange,
			isMultiSelectMode,
		],
	);

	const selectGroup = useCallback(
		(memberKeys: string[]) => {
			if (memberKeys.length === 0) return;

			let finalKeys: Set<string>;
			if (modifiersRef.current.meta || isMultiSelectMode) {
				finalKeys = new Set(selectedKeys);
				const allSelected = memberKeys.every((k) => finalKeys.has(k));
				for (const key of memberKeys) {
					if (allSelected) finalKeys.delete(key);
					else finalKeys.add(key);
				}
			} else {
				finalKeys = new Set(memberKeys);
			}

			lastClickedRef.current = memberKeys[0];
			onSelectionChange(finalKeys, memberKeys[0]);
		},
		[selectedKeys, onSelectionChange, isMultiSelectMode],
	);

	const ensureSelected = useCallback(
		(key: string) => {
			if (selectedKeys.has(key)) return selectedKeys;
			const finalKeys = new Set([key]);
			lastClickedRef.current = key;
			onSelectionChange(finalKeys, key);
			return finalKeys;
		},
		[selectedKeys, onSelectionChange],
	);

	return { createSelectionHandler, selectGroup, ensureSelected };
}

import { useCallback, useEffect, useRef } from "react";

/**
 * One entry in the list's display order. An expanded group contributes
 * its members as individual items; a COLLAPSED group or cluster is one
 * entry carrying all its members — a shift range that crosses it selects
 * them all, and it can serve as a range anchor.
 */
export type SelectionEntry =
	| { kind: "item"; key: string }
	| { kind: "cluster"; id: string; memberKeys: string[] };

type SelectionAnchor =
	| { kind: "item"; key: string }
	| { kind: "cluster"; id: string; memberKeys: string[] };

export interface UseListSelectionOptions {
	/** Display-order entries (visible rows; collapsed sections as one entry) */
	orderedEntries: SelectionEntry[];
	/** The current selection — the single source of truth */
	selectedKeys: Set<string>;
	/** Callback when selection changes */
	onSelectionChange: (keys: Set<string>, clickedKey?: string) => void;
	/** Whether multi-select mode is enabled */
	isMultiSelectMode?: boolean;
}

export interface UseListSelectionReturn {
	/**
	 * Creates an onSelectionChange handler for one ListBox section.
	 * sectionKeys scopes the click diff to that section; shift ranges
	 * span sections via the hook-level orderedEntries.
	 */
	createSelectionHandler: (
		sectionKeys: string[],
	) => (keys: "all" | Set<React.Key>) => void;
	/**
	 * Group-header click: plain click replaces the selection with the
	 * group members; meta/ctrl toggles the whole group in or out. Pass
	 * the cluster id so the range anchor lands on the cluster.
	 */
	selectGroup: (memberKeys: string[], clusterId?: string) => void;
	/**
	 * Context-menu opening: keeps the selection if the key is already
	 * in it, otherwise resets the selection to that key (Finder
	 * semantics). Returns the selection the menu should act on.
	 */
	ensureSelected: (key: string) => Set<string>;
	/**
	 * Marks a cluster as the shift-range anchor WITHOUT changing the
	 * selection — a cluster row's expand/collapse click still says
	 * "start here", so the next shift-click ranges from this cluster.
	 */
	anchorCluster: (id: string, memberKeys: string[]) => void;
}

/**
 * Cross-section selection controller for the resource lists.
 *
 * Selection state stays a flat Set of item keys; this hook adds the
 * display-order awareness: shift ranges walk the visible entries, where
 * a collapsed group/cluster counts as one entry whose members all join
 * a range that includes it.
 */
export function useListSelection(
	options: UseListSelectionOptions,
): UseListSelectionReturn {
	const {
		orderedEntries,
		selectedKeys,
		onSelectionChange,
		isMultiSelectMode = false,
	} = options;

	const modifiersRef = useRef({
		shift: false,
		meta: false,
	});
	const anchorRef = useRef<SelectionAnchor | null>(null);

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

	// Where an anchor sits in the current display order. An item anchor
	// that got collapsed away resolves to the cluster holding it; a
	// cluster anchor that got expanded resolves to its first member row.
	const anchorEntryIndex = useCallback(
		(anchor: SelectionAnchor): number => {
			if (anchor.kind === "item") {
				const direct = orderedEntries.findIndex(
					(e) => e.kind === "item" && e.key === anchor.key,
				);
				if (direct !== -1) return direct;
				return orderedEntries.findIndex(
					(e) =>
						e.kind === "cluster" &&
						e.memberKeys.includes(anchor.key),
				);
			}
			const direct = orderedEntries.findIndex(
				(e) => e.kind === "cluster" && e.id === anchor.id,
			);
			if (direct !== -1) return direct;
			return orderedEntries.findIndex(
				(e) => e.kind === "item" && anchor.memberKeys.includes(e.key),
			);
		},
		[orderedEntries],
	);

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

			// Shift ranges anchor on the last click, falling back to a sole
			// current selection (the seeded first item has no click history).
			const soleSelected =
				selectedKeys.size === 1 ? Array.from(selectedKeys)[0] : null;
			const shiftAnchor: SelectionAnchor | null =
				anchorRef.current ??
				(soleSelected ? { kind: "item", key: soleSelected } : null);

			if (modifiersRef.current.shift && shiftAnchor) {
				const start = anchorEntryIndex(shiftAnchor);
				const end = orderedEntries.findIndex(
					(e) => e.kind === "item" && e.key === clicked,
				);
				if (start !== -1 && end !== -1) {
					const [from, to] = [
						Math.min(start, end),
						Math.max(start, end),
					];
					finalKeys = new Set(
						orderedEntries
							.slice(from, to + 1)
							.flatMap((e) =>
								e.kind === "item" ? [e.key] : e.memberKeys,
							),
					);
				} else {
					finalKeys = new Set([...selectedKeys, clicked]);
				}
			} else if (!isMultiSelectMode && !modifiersRef.current.meta) {
				// A plain click that deselects the sole current selection
				// clears it (click again to cancel); any other plain click
				// narrows the selection to just that item.
				const togglingOff =
					added === undefined &&
					selectedKeys.size === 1 &&
					selectedKeys.has(clicked);
				finalKeys = togglingOff
					? new Set<string>()
					: new Set([clicked]);
			} else {
				finalKeys = new Set(selectedKeys);
				if (finalKeys.has(clicked)) {
					finalKeys.delete(clicked);
				} else {
					finalKeys.add(clicked);
				}
			}

			if (!modifiersRef.current.shift) {
				anchorRef.current = { kind: "item", key: clicked };
			}

			onSelectionChange(finalKeys, clicked);
		},
		[
			orderedEntries,
			anchorEntryIndex,
			selectedKeys,
			onSelectionChange,
			isMultiSelectMode,
		],
	);

	const selectGroup = useCallback(
		(memberKeys: string[], clusterId?: string) => {
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
				// Plain header click selects the whole group; clicking the
				// header of the group that is already the sole selection
				// cancels it (click again to cancel).
				const isSoleGroup =
					selectedKeys.size === memberKeys.length &&
					memberKeys.every((k) => selectedKeys.has(k));
				finalKeys = isSoleGroup
					? new Set<string>()
					: new Set(memberKeys);
			}

			anchorRef.current = clusterId
				? { kind: "cluster", id: clusterId, memberKeys }
				: { kind: "item", key: memberKeys[0] };
			onSelectionChange(finalKeys, memberKeys[0]);
		},
		[selectedKeys, onSelectionChange, isMultiSelectMode],
	);

	const ensureSelected = useCallback(
		(key: string) => {
			if (selectedKeys.has(key)) return selectedKeys;
			const finalKeys = new Set([key]);
			anchorRef.current = { kind: "item", key };
			onSelectionChange(finalKeys, key);
			return finalKeys;
		},
		[selectedKeys, onSelectionChange],
	);

	const anchorCluster = useCallback((id: string, memberKeys: string[]) => {
		anchorRef.current = { kind: "cluster", id, memberKeys };
	}, []);

	return {
		createSelectionHandler,
		selectGroup,
		ensureSelected,
		anchorCluster,
	};
}

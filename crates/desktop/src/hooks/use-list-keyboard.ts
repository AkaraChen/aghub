import { type RefObject, useEffect, useRef } from "react";

interface UseListKeyboardOptions {
	/** The list panel; shortcuts fire only while it is hovered or focused */
	containerRef: RefObject<HTMLElement | null>;
	/** Every selectable key, for select-all */
	allKeys: string[];
	selectedKeys: Set<string>;
	onSelectionChange: (keys: Set<string>) => void;
	/** Opens the delete confirmation for the current selection */
	onRequestDelete: () => void;
	/** Pause shortcuts (e.g. while a drag is underway) */
	disabled?: boolean;
}

/**
 * Standard list keyboard: Cmd/Ctrl+A selects all, Escape clears, and
 * Delete/Backspace opens the delete confirmation. Scoped to the list
 * panel (hover or focus) and skipped while an editable field is focused
 * or any overlay owns the keyboard.
 */
export function useListKeyboard(options: UseListKeyboardOptions) {
	const optionsRef = useRef(options);
	optionsRef.current = options;

	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			const {
				containerRef,
				allKeys,
				selectedKeys,
				onSelectionChange,
				onRequestDelete,
				disabled,
			} = optionsRef.current;
			if (disabled) return;

			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, [contenteditable]")) return;
			// A dialog or menu owns the keyboard while it is open. Context
			// menus stay mounted (hidden) for latency — and there can be
			// several — so ANY visible overlay counts.
			const overlays = document.querySelectorAll(
				'[role="dialog"], [role="menu"]',
			);
			for (const overlay of overlays) {
				if ((overlay as HTMLElement).getClientRects().length > 0)
					return;
			}

			const el = containerRef.current;
			if (!el) return;
			const scoped =
				el.matches(":hover") || el.contains(document.activeElement);
			if (!scoped) return;

			if ((event.metaKey || event.ctrlKey) && event.key === "a") {
				event.preventDefault();
				event.stopPropagation();
				onSelectionChange(new Set(allKeys));
			} else if (event.key === "Escape") {
				// Own Escape fully: react-aria's ListBox also handles it
				// (and stops propagation), so without capture+stop the
				// clear would be hijacked whenever the list has focus.
				event.stopPropagation();
				onSelectionChange(new Set());
			} else if (
				(event.key === "Delete" || event.key === "Backspace") &&
				selectedKeys.size > 0
			) {
				event.preventDefault();
				event.stopPropagation();
				onRequestDelete();
			}
		};

		// Capture phase — ahead of react-aria's element-level handlers.
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, []);
}

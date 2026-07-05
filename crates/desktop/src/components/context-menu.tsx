import { Menu, PopoverContent } from "@heroui/react";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";

export interface ContextMenuPosition {
	x: number;
	y: number;
}

export interface ContextMenuState<T> {
	position: ContextMenuPosition;
	context: T;
}

/**
 * Tracks an open context menu: `open` is meant for onContextMenu
 * handlers (prevents the webview-native menu), `context` carries
 * whatever the menu should act on (a key, a group, ...).
 */
export function useContextMenu<T>() {
	const [state, setState] = useState<ContextMenuState<T> | null>(null);

	const open = useCallback((event: React.MouseEvent, context: T) => {
		event.preventDefault();
		event.stopPropagation();
		setState({
			position: { x: event.clientX, y: event.clientY },
			context,
		});
	}, []);

	const close = useCallback(() => setState(null), []);

	return { state, open, close };
}

interface ContextMenuProps {
	position: ContextMenuPosition | null;
	onClose: () => void;
	"aria-label": string;
	children: ReactNode;
}

/**
 * Pointer-positioned menu: an invisible fixed anchor at the pointer
 * coordinates serves as the popover's trigger ref, so the menu reuses
 * the same HeroUI popover/menu styling as Dropdown.
 */
export function ContextMenu({
	position,
	onClose,
	"aria-label": ariaLabel,
	children,
}: ContextMenuProps) {
	const anchorRef = useRef<HTMLDivElement>(null);

	if (!position) return null;

	return (
		<>
			<div
				ref={anchorRef}
				style={{
					position: "fixed",
					left: position.x,
					top: position.y,
					width: 1,
					height: 1,
					pointerEvents: "none",
				}}
			/>
			<PopoverContent
				triggerRef={anchorRef}
				isOpen
				onOpenChange={(open) => {
					if (!open) onClose();
				}}
				placement="bottom start"
				// Standalone PopoverContent misses the popover surface
				// styling, so apply the overlay background/shadow itself.
				className="min-w-44 rounded-2xl border border-separator bg-overlay shadow-[var(--overlay-shadow)]"
			>
				<Menu aria-label={ariaLabel} onAction={() => onClose()}>
					{children}
				</Menu>
			</PopoverContent>
		</>
	);
}

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
 * the same HeroUI popover/menu styling as Dropdown. Choosing an item
 * blinks it once (the macOS confirmation) and closes the menu.
 */
export function ContextMenu({
	position,
	onClose,
	"aria-label": ariaLabel,
	children,
}: ContextMenuProps) {
	const anchorRef = useRef<HTMLDivElement>(null);
	const pressedItemRef = useRef<HTMLElement | null>(null);

	if (!position) return null;

	const handleAction = () => {
		const el = pressedItemRef.current;
		const reduce = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (el && !reduce) {
			el.animate(
				[{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
				{ duration: 120, easing: "linear" },
			);
			window.setTimeout(onClose, 130);
		} else {
			onClose();
		}
	};

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
				className="min-w-44 origin-top-left animate-[menu-in_var(--dur-fast)_var(--ease-out)] rounded-2xl border border-separator bg-overlay shadow-[var(--overlay-shadow)]"
			>
				<div
					onPointerUpCapture={(event) => {
						pressedItemRef.current = (
							event.target as HTMLElement
						).closest('[role="menuitem"]');
					}}
				>
					<Menu aria-label={ariaLabel} onAction={handleAction}>
						{children}
					</Menu>
				</div>
			</PopoverContent>
		</>
	);
}

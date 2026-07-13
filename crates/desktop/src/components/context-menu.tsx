import { Menu } from "@heroui/react";
import type { ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

interface ContextMenuPosition {
	x: number;
	y: number;
}

interface ContextMenuState<T> {
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
 * Pointer-positioned menu in a stays-mounted fixed container. A popover
 * would re-initialize its whole overlay machinery on every right-click
 * (~90ms even on a small list), so the container only toggles
 * visibility: open = position + one imperative entrance animation.
 * Dismissal (outside press, Escape) and bottom-edge flipping are
 * handled here. Choosing an item blinks it once (the macOS
 * confirmation) and closes the menu.
 */
export function ContextMenu({
	position,
	onClose,
	"aria-label": ariaLabel,
	children,
}: ContextMenuProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const pressedItemRef = useRef<HTMLElement | null>(null);
	const restoreFocusRef = useRef<HTMLElement | null>(null);
	// An outside pointer press hands focus to whatever was pressed — the
	// user is already interacting elsewhere, and yanking focus back would
	// hijack their typing. Only keyboard/action dismissal restores focus.
	const dismissedByPointerRef = useRef(false);
	const isOpen = position != null;

	// Remount the Menu on every open/close transition: react-aria's
	// static collection neither rebuilds on children changes (stale items
	// on reuse) nor tolerates its item ids changing (it throws "Cannot
	// change the id of an item" when a close swaps the children branch).
	// Remounting just the Menu is cheap — the expensive part this
	// component avoids is the popover overlay.
	const openSeqRef = useRef(0);
	const prevPositionRef = useRef<ContextMenuPosition | null>(null);
	if (prevPositionRef.current !== position) {
		prevPositionRef.current = position;
		openSeqRef.current += 1;
	}

	// Position, flip away from the viewport's bottom/right edges, play
	// the entrance, and move focus in — all after the DOM is visible.
	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el || !position) return;

		restoreFocusRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		dismissedByPointerRef.current = false;
		// A stale pressed item from a previous menu generation must not
		// leak into this one's action blink.
		pressedItemRef.current = null;

		// A previous action's blink may have released pointer events on
		// this shared container; a fresh open must intercept again.
		el.style.pointerEvents = "";

		const { offsetWidth, offsetHeight } = el;
		const pad = 8;
		const x = Math.min(position.x, window.innerWidth - offsetWidth - pad);
		const y = Math.min(position.y, window.innerHeight - offsetHeight - pad);
		el.style.left = `${Math.max(pad, x)}px`;
		el.style.top = `${Math.max(pad, y)}px`;

		const reduce = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (!reduce) {
			el.animate(
				[
					{ opacity: 0, transform: "scale(0.96)" },
					{ opacity: 1, transform: "scale(1)" },
				],
				{ duration: 120, easing: "cubic-bezier(0.2, 0, 0, 1)" },
			);
		}
		el.querySelector<HTMLElement>('[role="menu"]')?.focus();

		const handlePointerDown = (event: PointerEvent) => {
			if (!el.contains(event.target as Node)) {
				dismissedByPointerRef.current = true;
				onClose();
			}
		};
		// Escape closes regardless of where focus sits (the menu may not
		// have taken it) — capture phase, ahead of other handlers.
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("keydown", handleKeyDown, true);
			if (!dismissedByPointerRef.current) {
				restoreFocusRef.current?.focus();
			}
		};
	}, [position, onClose]);

	const handleAction = () => {
		const el = pressedItemRef.current;
		const container = containerRef.current;
		const reduce = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (el && container && !reduce) {
			// The confirmation blink keeps the menu visible for ~130ms; let
			// pointer events pass through so it never blocks what follows,
			// and only close OUR generation — a new menu may have opened in
			// the meantime and must not be torn down by this timer.
			const seq = openSeqRef.current;
			container.style.pointerEvents = "none";
			el.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], {
				duration: 120,
				easing: "linear",
			});
			window.setTimeout(() => {
				if (openSeqRef.current === seq) {
					container.style.pointerEvents = "";
					onClose();
				}
			}, 130);
		} else {
			onClose();
		}
	};

	return (
		<div
			ref={containerRef}
			hidden={!isOpen}
			onPointerUpCapture={(event) => {
				pressedItemRef.current = (event.target as HTMLElement).closest(
					'[role="menuitem"]',
				);
			}}
			className="fixed z-50 min-w-44 origin-top-left rounded-2xl border border-separator bg-overlay shadow-[var(--overlay-shadow)]"
		>
			<Menu
				key={openSeqRef.current}
				aria-label={ariaLabel}
				onAction={handleAction}
			>
				{children}
			</Menu>
		</div>
	);
}

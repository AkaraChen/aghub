import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface PanelTransitionProps {
	/** Remounts (and replays the entrance) when the panel state changes */
	stateKey: string;
	className?: string;
	children: ReactNode;
}

/**
 * The right panel's shared state transition: keyed by panel state so a
 * detail ↔ bulk ↔ empty switch replays a short fade/slide entrance
 * instead of hard-swapping. Entrance-only by design — an exit animation
 * would delay the incoming state.
 */
export function PanelTransition({
	stateKey,
	className,
	children,
}: PanelTransitionProps) {
	return (
		<div
			key={stateKey}
			className={cn(
				"h-full animate-[panel-in_var(--dur-base)_var(--ease-out)_both]",
				className,
			)}
		>
			{children}
		</div>
	);
}

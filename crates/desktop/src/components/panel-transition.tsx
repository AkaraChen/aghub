import type { ReactNode } from "react";

interface PanelTransitionProps {
	/** Remounts (and replays the entrance) when the panel state changes */
	stateKey: string;
	children: ReactNode;
}

/**
 * The right panel's shared state transition: keyed by panel state so a
 * detail ↔ bulk ↔ empty switch replays a short fade/slide entrance
 * instead of hard-swapping. Entrance-only by design — an exit animation
 * would delay the incoming state.
 */
export function PanelTransition({ stateKey, children }: PanelTransitionProps) {
	return (
		<div
			key={stateKey}
			className="h-full animate-[panel-in_var(--dur-base)_var(--ease-out)_both]"
		>
			{children}
		</div>
	);
}

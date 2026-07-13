/**
 * Runs a state update inside a View Transition when the platform supports
 * it, so elements carrying a view-transition-name slide to their new
 * position instead of teleporting. Falls back to a plain call when the
 * API is missing or the user prefers reduced motion — zero behavior
 * difference either way.
 */
export async function withViewTransition(
	update: () => Promise<void> | void,
): Promise<void> {
	const reduce = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	if (reduce || typeof document.startViewTransition !== "function") {
		await update();
		return;
	}
	await document
		.startViewTransition(() => update())
		.finished.catch(() => {
			// An interrupted transition is fine; the DOM update still landed.
		});
}

/** A CSS custom-ident-safe view-transition-name for a resource key. */
export function viewTransitionName(prefix: string, key: string): string {
	return `${prefix}-${key.replace(/[^\w-]/g, "-")}`;
}

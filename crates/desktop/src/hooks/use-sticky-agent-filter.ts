import { useSyncExternalStore } from "react";

/**
 * Module-level store that remembers the most recently active agent filter
 * across page navigations. The URL on a resource page is the source of
 * truth for what the page actually filters by; this store mirrors that
 * value but keeps it around when the user steps away to a non-resource
 * page (Inference Providers, Market, Settings, etc.). When the user
 * returns to a resource page, the sidebar can restore the filter from
 * here so it doesn't get lost.
 *
 * In-memory only — cleared on app reload.
 */

let stickyAgent: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot(): string | null {
	return stickyAgent;
}

export function setStickyAgentFilter(value: string | null) {
	if (stickyAgent === value) return;
	stickyAgent = value;
	for (const listener of listeners) listener();
}

export function useStickyAgentFilter(): string | null {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

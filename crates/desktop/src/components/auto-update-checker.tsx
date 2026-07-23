import { toast } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { startupUpdateQueryOptions } from "../requests/updates";

/**
 * Runs a single background `check()` on app startup, gated by the
 * `autoCheckUpdates` preference. If an update is found, surfaces a
 * toast whose action takes the user to the Settings → Application
 * panel where they can install it.
 *
 * The fetch is owned by React Query (`useQuery`); the toast is
 * surfaced as a side effect of the fetched data, which is the
 * documented pattern for this codebase (see AGENTS.md: "use
 * `useQuery` from React Query or custom hooks instead" of
 * `useEffect` for data fetching).
 *
 * Errors are swallowed silently — the user can always trigger a
 * manual check from Settings.
 */
export function AutoUpdateChecker() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const surfacedRef = useRef(false);

	const { data: update } = useQuery(startupUpdateQueryOptions());

	useEffect(() => {
		if (!update || surfacedRef.current) return;
		surfacedRef.current = true;

		toast.success(t("updateAvailable", { version: update.version }), {
			description: t("clickToCheckUpdates"),
			actionProps: {
				onPress: () => setLocation("/settings"),
				variant: "tertiary",
				children: t("openSettings"),
			},
		});
	}, [setLocation, t, update]);

	return null;
}

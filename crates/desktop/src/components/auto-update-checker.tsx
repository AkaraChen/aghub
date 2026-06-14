import { toast } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { getAutoCheckUpdates } from "../lib/store";

const AUTO_UPDATE_CHECK_KEY = ["auto-update-check"] as const;
const SESSION_STORAGE_KEY = "aghub-auto-update-check-session";

interface AutoUpdateCheckResult {
	update: Update | null;
}

async function runAutoUpdateCheck(): Promise<AutoUpdateCheckResult> {
	if (typeof window !== "undefined") {
		try {
			if (window.sessionStorage.getItem(SESSION_STORAGE_KEY)) {
				return { update: null };
			}
			window.sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
		} catch {
			// sessionStorage may be unavailable; fall through and let
			// the preference gate handle dedupe within this session.
		}
	}

	const enabled = await getAutoCheckUpdates();
	if (!enabled) {
		return { update: null };
	}

	const update = await check();
	return { update };
}

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

	const { data } = useQuery<AutoUpdateCheckResult>({
		queryKey: AUTO_UPDATE_CHECK_KEY,
		queryFn: runAutoUpdateCheck,
		staleTime: Infinity,
		gcTime: Infinity,
		retry: false,
	});

	useEffect(() => {
		if (!data?.update || surfacedRef.current) return;
		surfacedRef.current = true;

		toast.success(t("updateAvailable", { version: data.update.version }), {
			description: t("clickToCheckUpdates"),
			actionProps: {
				onPress: () => setLocation("/settings"),
				variant: "tertiary",
				children: t("openSettings"),
			},
		});
	}, [data, setLocation, t]);

	return null;
}

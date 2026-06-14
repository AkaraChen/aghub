import { toast } from "@heroui/react";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getAutoCheckUpdates } from "../lib/store";

const SESSION_STORAGE_KEY = "aghub-auto-update-check-session";

/**
 * Runs a single background `check()` on app startup, gated by the
 * `autoCheckUpdates` preference. If an update is found, surfaces a
 * toast that takes the user to the Settings → Application panel.
 *
 * Silently swallows errors (network failures etc.) — the user can
 * always trigger a manual check from Settings.
 */
export function AutoUpdateChecker() {
	const { t } = useTranslation();
	const ranForSessionRef = useRef(false);

	useEffect(() => {
		if (ranForSessionRef.current) return;
		ranForSessionRef.current = true;

		// Ensure at most one auto-check per app session, even if the
		// component is re-mounted (HMR, fast refresh, etc.).
		if (typeof window !== "undefined") {
			try {
				if (window.sessionStorage.getItem(SESSION_STORAGE_KEY)) {
					return;
				}
				window.sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
			} catch {
				// sessionStorage may be unavailable; fall through and
				// rely on the in-memory ref to dedupe within this mount.
			}
		}

		let cancelled = false;

		const run = async () => {
			try {
				const enabled = await getAutoCheckUpdates();
				if (!enabled || cancelled) return;

				const update = await check();
				if (!update || cancelled) return;

				toast.success(
					t("updateAvailable", { version: update.version }),
					{
						description: t("clickToCheckUpdates"),
					},
				);
			} catch (error) {
				console.warn("Automatic update check failed:", error);
			}
		};

		void run();

		return () => {
			cancelled = true;
		};
	}, [t]);

	return null;
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { CCPluginMarketResponse } from "../generated/dto";

type InstallState = "installing" | "installed";

const MIN_INSTALLING_DURATION_MS = 800;
const INSTALLED_FEEDBACK_DURATION_MS = 1200;

export function usePluginInstallState() {
	const [installStateById, setInstallStateById] = useState<
		Record<string, InstallState>
	>({});
	const [transientPluginsById, setTransientPluginsById] = useState<
		Record<string, CCPluginMarketResponse>
	>({});
	const feedbackTimeoutsRef = useRef<
		Map<string, ReturnType<typeof setTimeout>>
	>(new Map());
	const installStartedAtRef = useRef<Map<string, number>>(new Map());

	useEffect(() => {
		const timeouts = feedbackTimeoutsRef.current;
		return () => {
			for (const timeout of timeouts.values()) {
				clearTimeout(timeout);
			}
			timeouts.clear();
		};
	}, []);

	const clearFeedbackTimeout = useCallback((pluginId: string) => {
		const timeout = feedbackTimeoutsRef.current.get(pluginId);
		if (timeout) {
			clearTimeout(timeout);
			feedbackTimeoutsRef.current.delete(pluginId);
		}
	}, []);

	const markInstalling = useCallback(
		(pluginId: string, plugin: CCPluginMarketResponse) => {
			clearFeedbackTimeout(pluginId);
			installStartedAtRef.current.set(pluginId, Date.now());
			setInstallStateById((current) => ({
				...current,
				[pluginId]: "installing",
			}));
			setTransientPluginsById((current) => ({
				...current,
				[pluginId]: plugin,
			}));
		},
		[clearFeedbackTimeout],
	);

	const markInstalled = useCallback(
		(pluginId: string) => {
			const startedAt =
				installStartedAtRef.current.get(pluginId) ?? Date.now();
			const elapsed = Date.now() - startedAt;
			const installDelay = Math.max(
				0,
				MIN_INSTALLING_DURATION_MS - elapsed,
			);

			clearFeedbackTimeout(pluginId);
			const installingTimeout = setTimeout(() => {
				setInstallStateById((current) => ({
					...current,
					[pluginId]: "installed",
				}));
				const installedTimeout = setTimeout(() => {
					setInstallStateById((current) => {
						const next = { ...current };
						delete next[pluginId];
						return next;
					});
					setTransientPluginsById((current) => {
						const next = { ...current };
						delete next[pluginId];
						return next;
					});
					installStartedAtRef.current.delete(pluginId);
					feedbackTimeoutsRef.current.delete(pluginId);
				}, INSTALLED_FEEDBACK_DURATION_MS);
				feedbackTimeoutsRef.current.set(pluginId, installedTimeout);
			}, installDelay);
			feedbackTimeoutsRef.current.set(pluginId, installingTimeout);
		},
		[clearFeedbackTimeout],
	);

	const clearInstallState = useCallback(
		(pluginId: string) => {
			clearFeedbackTimeout(pluginId);
			installStartedAtRef.current.delete(pluginId);
			setInstallStateById((current) => {
				const next = { ...current };
				delete next[pluginId];
				return next;
			});
			setTransientPluginsById((current) => {
				const next = { ...current };
				delete next[pluginId];
				return next;
			});
		},
		[clearFeedbackTimeout],
	);

	return {
		installStateById,
		transientPluginsById,
		markInstalling,
		markInstalled,
		clearInstallState,
	};
}

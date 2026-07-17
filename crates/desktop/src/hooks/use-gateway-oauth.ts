import { toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { GatewayOauthProvider } from "../generated/dto";
import { useApi } from "./use-api";
import { invalidateGatewayAuthFileQueries } from "../requests/gateway";

const OAUTH_POLL_INTERVAL_MS = 2_000;
const OAUTH_POLL_TIMEOUT_MS = 120_000;

function sleep(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface UseGatewayOauthParams {
	instanceId: string;
	onSuccess?: () => void;
}

/**
 * Runs the full browser-based OAuth flow against a gateway instance:
 * requests the auth URL, opens it in the system browser, then polls
 * `oauth/status` every 2s (up to 120s) until the login lands or fails.
 */
export function useGatewayOauth({
	instanceId,
	onSuccess,
}: UseGatewayOauthParams) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const cancelledRef = useRef(false);

	const mutation = useMutation({
		mutationFn: async (provider: GatewayOauthProvider) => {
			cancelledRef.current = false;
			const { url, state } = await api.gateway.startOauth(instanceId, {
				provider,
			});
			await openUrl(url);

			const deadline = Date.now() + OAUTH_POLL_TIMEOUT_MS;
			while (Date.now() < deadline) {
				await sleep(OAUTH_POLL_INTERVAL_MS);
				if (cancelledRef.current) {
					return "cancelled" as const;
				}
				const poll = await api.gateway.oauthStatus(instanceId, state);
				if (poll.status === "ok") {
					return "ok" as const;
				}
				if (poll.status === "error") {
					throw new Error(poll.error ?? t("gatewayOauthFailed"));
				}
			}
			throw new Error(t("gatewayOauthTimeout"));
		},
		onSuccess: async (outcome) => {
			if (outcome !== "ok") return;
			await invalidateGatewayAuthFileQueries(queryClient, instanceId);
			toast.success(t("gatewayOauthSuccess"));
			onSuccess?.();
		},
		onError: (error) => {
			console.error("Gateway OAuth flow failed:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayOauthFailed"),
			);
		},
	});

	const cancel = () => {
		cancelledRef.current = true;
	};

	return {
		start: mutation.mutate,
		isPending: mutation.isPending,
		cancel,
	};
}

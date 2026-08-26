import { toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GatewayOauthProvider } from "../generated/dto";
import { useApi } from "./use-api";
import { invalidateGatewayAuthFileQueries } from "../requests/gateway";

const OAUTH_POLL_INTERVAL_MS = 2_000;
const OAUTH_POLL_TIMEOUT_MS = 120_000;

function sleep(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export interface GatewayOauthAuthInfo {
	/** `"device"` for device-code providers (kimi/xai). */
	flow: string | null;
	userCode: string | null;
	/** Epoch ms when the device code expires. */
	expiresAt: number | null;
}

interface UseGatewayOauthParams {
	instanceId: string;
	onSuccess?: () => void;
}

/**
 * Runs the full browser-based OAuth flow against a gateway instance:
 * requests the auth URL, opens it in the system browser, then polls
 * `oauth/status` every 2s (up to 120s) until the login lands or fails.
 * Device-code providers surface their user code via `authInfo` so the
 * waiting dialog can display it.
 */
export function useGatewayOauth({
	instanceId,
	onSuccess,
}: UseGatewayOauthParams) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const cancelledRef = useRef(false);
	const [authInfo, setAuthInfo] = useState<GatewayOauthAuthInfo | null>(null);

	const mutation = useMutation({
		mutationFn: async (provider: GatewayOauthProvider) => {
			cancelledRef.current = false;
			const auth = await api.gateway.startOauth(instanceId, {
				provider,
			});
			setAuthInfo({
				flow: auth.flow,
				userCode: auth.user_code,
				expiresAt:
					auth.expires_in != null
						? Date.now() + auth.expires_in * 1000
						: null,
			});
			await openUrl(auth.url);

			const deadline = Date.now() + OAUTH_POLL_TIMEOUT_MS;
			while (Date.now() < deadline) {
				await sleep(OAUTH_POLL_INTERVAL_MS);
				if (cancelledRef.current) {
					return "cancelled" as const;
				}
				const poll = await api.gateway.oauthStatus(
					instanceId,
					auth.state,
				);
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
		onSettled: () => {
			setAuthInfo(null);
		},
	});

	const cancel = () => {
		cancelledRef.current = true;
	};

	return {
		start: mutation.mutate,
		isPending: mutation.isPending,
		cancel,
		authInfo,
	};
}

import { toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../../hooks/use-api";
import {
	gatewayProvisionStatusQueryOptions,
	invalidateGatewayInstanceQueries,
	provisionGatewayMutationOptions,
} from "../../../requests/gateway";

/**
 * Drives the global CLIProxyAPI binary download: exposes the polled
 * provision status (1s interval while downloading/extracting) and the
 * idempotent trigger mutation. Once a download this hook started or
 * observed in flight reaches a terminal phase, it refreshes the instance
 * list (the managed instance flips from `not_provisioned` to `stopped`)
 * and surfaces a toast.
 */
export function useGatewayProvision({ enabled }: { enabled: boolean }) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	// True between "user pressed download / a download is running" and the
	// next terminal phase, so a pre-existing `ready` state on mount never
	// triggers the completion toast.
	const inFlightRef = useRef(false);

	const statusQuery = useQuery(
		gatewayProvisionStatusQueryOptions({ api, enabled }),
	);

	const provisionMutation = useMutation({
		// The mutation seeds the status cache, so the effect below handles
		// both the fast path (already downloaded → `ready` right away) and
		// the polled path.
		...provisionGatewayMutationOptions({ api, queryClient }),
		onError: (error) => {
			inFlightRef.current = false;
			console.error("Failed to provision gateway binary:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayProvisionFailed"),
			);
		},
	});

	const status = statusQuery.data ?? null;

	useEffect(() => {
		if (!status) return;
		if (status.phase === "downloading" || status.phase === "extracting") {
			inFlightRef.current = true;
			return;
		}
		if (!inFlightRef.current) return;
		inFlightRef.current = false;
		if (status.phase === "ready") {
			void invalidateGatewayInstanceQueries(queryClient);
			toast.success(t("gatewayProvisionReady"));
		} else if (status.phase === "failed") {
			toast.danger(status.message ?? t("gatewayProvisionFailed"));
		}
	}, [status, queryClient, t]);

	const isDownloading =
		status?.phase === "downloading" ||
		status?.phase === "extracting" ||
		provisionMutation.isPending;

	const provision = () => {
		inFlightRef.current = true;
		provisionMutation.mutate();
	};

	return { status, isDownloading, provision };
}

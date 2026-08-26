import { toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getGatewayMirror } from "../lib/store";
import { invalidateGatewayInstanceQueries } from "../requests/gateway";
import { useApi } from "./use-api";

const PROVISION_POLL_INTERVAL_MS = 1_000;
const PROVISION_TIMEOUT_MS = 10 * 60_000;

function sleep(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type GatewayLaunchStage =
	"idle" | "preparing" | "downloading" | "starting";

interface GatewayLaunchVariables {
	/** Also start the instance once the binary is in place. */
	start: boolean;
}

/**
 * One-click "install and start" orchestration for the managed gateway:
 * creates the managed instance if missing, provisions the binary (with
 * the configured mirror) while reporting download progress, then starts
 * the instance. Each step is skipped when already satisfied, so the same
 * call works as plain "install" (`start: false`) or as a retry.
 */
export function useGatewayLaunch() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [stage, setStage] = useState<GatewayLaunchStage>("idle");
	const [progress, setProgress] = useState<number | null>(null);

	const mutation = useMutation({
		mutationFn: async ({ start }: GatewayLaunchVariables) => {
			setStage("preparing");
			setProgress(null);

			const instances = await api.gateway.listInstances();
			let instance = instances.find((item) => item.kind === "managed");
			if (!instance) {
				instance = await api.gateway.createManaged({
					name: null,
					port: null,
				});
			}

			if (instance.status === "not_provisioned") {
				const mirror = await getGatewayMirror();
				let status = await api.gateway.provision({ mirror });
				setStage("downloading");
				const deadline = Date.now() + PROVISION_TIMEOUT_MS;
				while (status.phase !== "ready") {
					if (status.phase === "failed") {
						throw new Error(
							status.message ?? t("gatewayProvisionFailed"),
						);
					}
					if (Date.now() > deadline) {
						throw new Error(t("gatewayProvisionFailed"));
					}
					await sleep(PROVISION_POLL_INTERVAL_MS);
					status = await api.gateway.provisionStatus();
					setProgress(
						status.phase === "downloading" ? status.progress : null,
					);
				}
			}

			const canStart =
				instance.status === "not_provisioned" ||
				instance.status === "stopped";
			if (start && canStart) {
				setStage("starting");
				await api.gateway.startInstance(instance.id);
			}
			return instance;
		},
		onSuccess: (_instance, variables) => {
			toast.success(
				variables.start
					? t("gatewayLaunchReady")
					: t("gatewayProvisionReady"),
			);
		},
		onError: (error) => {
			console.error("Failed to launch gateway:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayStartFailed"),
			);
		},
		onSettled: async () => {
			setStage("idle");
			setProgress(null);
			await invalidateGatewayInstanceQueries(queryClient);
		},
	});

	return {
		launch: mutation.mutate,
		isPending: mutation.isPending,
		stage,
		progress,
	};
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi } from "../hooks/use-api";
import { invalidateGatewayInstanceQueries } from "../requests/gateway";
import type { ApiClient } from "../requests/client";

const GATEWAY_AUTO_START_KEY = ["gateway-auto-start"] as const;

let completed = false;
let inFlight: Promise<void> | null = null;

function runAutoStart(api: ApiClient) {
	if (completed) return Promise.resolve();
	if (inFlight) return inFlight;

	inFlight = (async () => {
		const instances = await api.gateway.listInstances();
		for (const instance of instances) {
			if (
				instance.kind !== "managed" ||
				!instance.auto_start ||
				instance.status !== "stopped"
			) {
				continue;
			}
			try {
				await api.gateway.startInstance(instance.id);
			} catch (error) {
				console.error(
					`Failed to auto-start gateway instance ${instance.name}:`,
					error,
				);
			}
		}
		completed = true;
	})().finally(() => {
		inFlight = null;
	});

	return inFlight;
}

/**
 * On app startup, starts every managed gateway instance whose
 * `auto_start` flag is set and that is currently stopped. Failures are
 * logged so the other opted-in instances still start; discovery is retried
 * once before the user needs to start an instance manually.
 */
export function GatewayAutoStart() {
	const api = useApi();
	const queryClient = useQueryClient();

	const { mutate: startAutomatically } = useMutation({
		mutationKey: GATEWAY_AUTO_START_KEY,
		mutationFn: () => runAutoStart(api),
		retry: 1,
		retryDelay: 250,
		onSuccess: async () => {
			await invalidateGatewayInstanceQueries(queryClient);
		},
	});

	useEffect(() => {
		startAutomatically();
	}, [startAutomatically]);

	return null;
}

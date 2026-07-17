import { useQuery } from "@tanstack/react-query";
import { useApi } from "../hooks/use-api";

const GATEWAY_AUTO_START_KEY = ["gateway-auto-start"] as const;

// Module-level guard: the query key can be refetched (window focus,
// cache eviction), but auto-start must only ever run once per app launch.
let hasRun = false;

/**
 * On app startup, starts every managed gateway instance whose
 * `auto_start` flag is set and that is currently stopped. Failures are
 * logged and swallowed — the user can always start instances manually
 * from the gateway page.
 */
export function GatewayAutoStart() {
	const api = useApi();

	useQuery({
		queryKey: GATEWAY_AUTO_START_KEY,
		queryFn: async () => {
			if (hasRun) return true;
			hasRun = true;

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
			return true;
		},
		staleTime: Infinity,
		gcTime: Infinity,
		retry: false,
	});

	return null;
}

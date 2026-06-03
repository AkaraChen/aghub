import { useMemo } from "react";
import { getApiClient } from "../requests/client";
import { useServer } from "./use-server";

export function useApi() {
	const { authToken, baseUrl } = useServer();

	return useMemo(
		() => getApiClient(baseUrl, authToken),
		[baseUrl, authToken],
	);
}

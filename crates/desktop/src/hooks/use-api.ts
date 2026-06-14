import { useMemo } from "react";
import { getApiClient } from "../requests/client";
import { useServer } from "./use-server";

export function useApi() {
	const { baseUrl, token } = useServer();

	return useMemo(() => getApiClient(baseUrl, token), [baseUrl, token]);
}

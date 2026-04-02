import { useMemo } from "react";
import { getApiClient } from "../requests/client";
import { useServer } from "./use-server";

export function useApi() {
	const { baseUrl } = useServer();

	return useMemo(() => getApiClient(baseUrl), [baseUrl]);
}

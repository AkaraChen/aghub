import { useQuery } from "@tanstack/react-query";
import { createApi } from "../lib/api";
import { useServer } from "./use-server";

const CODE_EDITORS_KEY = "code-editors";

export function useCodeEditors() {
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	return useQuery({
		queryKey: [CODE_EDITORS_KEY],
		queryFn: () => api.integrations.listCodeEditors(),
	});
}

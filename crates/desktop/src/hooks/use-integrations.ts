import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useRefreshIntegrations() {
	const queryClient = useQueryClient();
	return () => {
		queryClient.invalidateQueries({ queryKey: [CODE_EDITORS_KEY] });
	};
}

export function useOpenWithEditor() {
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	return useMutation({
		mutationFn: ({ path, editor }: { path: string; editor: string }) =>
			api.integrations.openWithEditor(
				path,
				editor as import("../lib/api-types").CodeEditorType,
			),
	});
}

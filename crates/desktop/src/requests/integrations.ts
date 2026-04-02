import { mutationOptions, queryOptions } from "@tanstack/react-query";
import type { CodeEditorType } from "../lib/api-types";
import type { ApiClient } from "./client";
import { queryKeys } from "./keys";

interface IntegrationsQueryParams {
	api: ApiClient;
}

export function codeEditorsQueryOptions({ api }: IntegrationsQueryParams) {
	return queryOptions({
		queryKey: queryKeys.integrations.codeEditors(),
		queryFn: () => api.integrations.listCodeEditors(),
	});
}

export function openWithEditorMutationOptions({
	api,
}: IntegrationsQueryParams) {
	return mutationOptions({
		mutationFn: ({
			path,
			editor,
		}: {
			path: string;
			editor: CodeEditorType;
		}) => api.integrations.openWithEditor(path, editor),
	});
}

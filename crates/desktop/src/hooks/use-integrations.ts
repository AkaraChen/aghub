import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { createApi } from "../lib/api";
import type { CodeEditorType } from "../lib/api-types";
import {
	getIntegrationPreferences,
	saveIntegrationPreferences,
} from "../lib/store";
import { useServer } from "./use-server";

const CODE_EDITORS_KEY = "code-editors";
const INTEGRATION_PREFERENCES_KEY = "integration-preferences";

export function useCurrentCodeEditor() {
	const queryClient = useQueryClient();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const { data: codeEditors, isLoading: isLoadingEditors } = useQuery({
		queryKey: [CODE_EDITORS_KEY],
		queryFn: () => api.integrations.listCodeEditors(),
	});
	const { data: preferences, isLoading: isLoadingPreferences } = useQuery({
		queryKey: [INTEGRATION_PREFERENCES_KEY],
		queryFn: getIntegrationPreferences,
	});

	const preferredEditor = preferences?.codeEditor;

	const selectedEditor = useMemo(() => {
		if (preferredEditor) {
			return preferredEditor;
		}

		return codeEditors?.find((editor) => editor.installed)?.id as
			| CodeEditorType
			| undefined;
	}, [codeEditors, preferredEditor]);

	const currentEditor = useMemo(
		() => codeEditors?.find((editor) => editor.id === selectedEditor),
		[codeEditors, selectedEditor],
	);

	const setCurrentEditor = useCallback(
		async (editor: CodeEditorType | undefined) => {
			const nextPreferences = { codeEditor: editor };
			queryClient.setQueryData(
				[INTEGRATION_PREFERENCES_KEY],
				nextPreferences,
			);
			await saveIntegrationPreferences(nextPreferences);
		},
		[queryClient],
	);

	return {
		codeEditors,
		currentEditor,
		selectedEditor,
		setCurrentEditor,
		isLoading: isLoadingEditors || isLoadingPreferences,
	};
}

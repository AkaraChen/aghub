import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { CodeEditorType } from "../generated/dto/CodeEditorType";
import {
	getIntegrationPreferences,
	saveIntegrationPreferences,
} from "../lib/store";
import { codeEditorsQueryOptions } from "../requests/integrations";
import { useApi } from "./use-api";

const INTEGRATION_PREFERENCES_KEY = "integration-preferences";

export function useCurrentCodeEditor() {
	const queryClient = useQueryClient();
	const api = useApi();
	const { data: codeEditors, isLoading: isLoadingEditors } = useQuery({
		...codeEditorsQueryOptions({ api }),
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

import Editor, { type BeforeMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback } from "react";
import { AGHUB_DARK_THEME, BASE_MONACO_OPTIONS } from "./monaco-theme";

interface RawEditorProps {
	language: string;
	value: string;
	onChange: (value: string) => void;
	readOnly?: boolean;
	onMount?: (editor: editor.IStandaloneCodeEditor) => void;
	options?: editor.IStandaloneEditorConstructionOptions;
}

export function RawEditor({
	language,
	value,
	onChange,
	readOnly = false,
	onMount,
	options,
}: RawEditorProps) {
	const handleBeforeMount: BeforeMount = useCallback((m) => {
		m.editor.defineTheme("aghub-dark", AGHUB_DARK_THEME);
	}, []);

	return (
		<div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-surface">
			<Editor
				height="100%"
				defaultLanguage={language}
				value={value}
				onChange={(v) => onChange(v ?? "")}
				beforeMount={handleBeforeMount}
				onMount={(ed) => {
					ed.revealLine(1);
					onMount?.(ed);
				}}
				theme="aghub-dark"
				loading={<div className="h-full bg-surface" />}
				options={{
					...BASE_MONACO_OPTIONS,
					readOnly,
					...options,
				}}
			/>
		</div>
	);
}

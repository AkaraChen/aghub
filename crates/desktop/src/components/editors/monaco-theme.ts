import type { editor } from "monaco-editor";

export const AGHUB_DARK_THEME: editor.IStandaloneThemeData = {
	base: "vs-dark",
	inherit: true,
	rules: [
		{ token: "comment", foreground: "6b7280" },
		{ token: "string", foreground: "a5b4c8" },
		{ token: "number", foreground: "93b5e8" },
		{ token: "keyword", foreground: "c4a5e0" },
		{ token: "type", foreground: "8ec8d8" },
		{ token: "delimiter", foreground: "6b7280" },
	],
	colors: {
		"editor.background": "#18181b",
		"editor.foreground": "#d4d4d8",
		"editor.lineHighlightBackground": "#ffffff08",
		"editor.selectionBackground": "#3b82f640",
		"editorCursor.foreground": "#d4d4d8",
		"editorLineNumber.foreground": "#52525b",
		"editorLineNumber.activeForeground": "#a1a1aa",
		"editor.inactiveSelectionBackground": "#3b82f620",
		"editorIndentGuide.background": "#27272a",
		"editorIndentGuide.activeBackground": "#3f3f46",
		"scrollbarSlider.background": "#ffffff10",
		"scrollbarSlider.hoverBackground": "#ffffff20",
	},
};

export const BASE_MONACO_OPTIONS: editor.IStandaloneEditorConstructionOptions =
	{
		minimap: { enabled: false },
		fontSize: 13,
		lineNumbers: "on",
		scrollBeyondLastLine: false,
		wordWrap: "on",
		tabSize: 2,
		automaticLayout: true,
		padding: { top: 0 },
		glyphMargin: false,
		folding: false,
		lineNumbersMinChars: 3,
		lineDecorationsWidth: 8,
	};

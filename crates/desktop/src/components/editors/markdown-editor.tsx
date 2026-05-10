import type { editor } from "monaco-editor";
import { useMonaco } from "@monaco-editor/react";
import { useRef, useState } from "react";
import { RawEditor } from "./raw-editor";

interface MarkdownEditorProps {
	content: string;
	onDirtyChange?: (dirty: boolean) => void;
}

export function MarkdownEditor({
	content,
	onDirtyChange,
}: MarkdownEditorProps) {
	const [draft, setDraft] = useState(content);
	const [editing, setEditing] = useState(false);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const monaco = useMonaco();

	const handleChange = (value: string) => {
		setDraft(value);
		onDirtyChange?.(value !== content);
	};

	const handleMount = (ed: editor.IStandaloneCodeEditor) => {
		editorRef.current = ed;
		ed.onMouseDown(() => {
			if (monaco && ed.getOption(monaco.editor.EditorOption.readOnly)) {
				setEditing(true);
				ed.updateOptions({ readOnly: false });
				ed.focus();
			}
		});
	};

	return (
		<RawEditor
			language="markdown"
			value={draft}
			onChange={handleChange}
			readOnly={!editing}
			onMount={handleMount}
			options={{
				renderLineHighlight: editing ? "line" : "none",
			}}
		/>
	);
}

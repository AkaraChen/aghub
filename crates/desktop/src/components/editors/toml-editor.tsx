import { useState } from "react";
import { RawEditor } from "./raw-editor";

interface TomlEditorProps {
	content: string;
	onDirtyChange?: (dirty: boolean) => void;
}

export function TomlEditor({ content, onDirtyChange }: TomlEditorProps) {
	const [draft, setDraft] = useState(content);

	const handleChange = (value: string) => {
		setDraft(value);
		onDirtyChange?.(value !== content);
	};

	return <RawEditor language="toml" value={draft} onChange={handleChange} />;
}

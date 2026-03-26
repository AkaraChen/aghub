import { useTranslation } from "react-i18next";
import type { KeyPair } from "../lib/key-pair-utils";
import { KeyPairEditor } from "./key-pair-editor";

export type HttpHeader = KeyPair;

interface HttpHeaderEditorProps {
	value: HttpHeader[];
	onChange: (value: HttpHeader[]) => void;
	variant?: "default" | "secondary";
}

export function HttpHeaderEditor({
	value,
	onChange,
	variant,
}: HttpHeaderEditorProps) {
	const { t } = useTranslation();

	return (
		<KeyPairEditor
			value={value}
			onChange={onChange}
			keyPlaceholder={t("httpHeaderEditor.keyPlaceholder")}
			valuePlaceholder={t("httpHeaderEditor.valuePlaceholder")}
			variant={variant}
		/>
	);
}

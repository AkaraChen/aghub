import { ClipboardDocumentIcon } from "@heroicons/react/24/solid";
import { Button } from "@heroui/react";
import * as dotenv from "dotenv";
import { useTranslation } from "react-i18next";
import type { KeyPair } from "../lib/key-pair-utils";
import { objectToKeyPairs } from "../lib/key-pair-utils";
import { KeyPairEditor } from "./key-pair-editor";

export type EnvVar = KeyPair;

interface EnvEditorProps {
	value: EnvVar[];
	onChange: (value: EnvVar[]) => void;
	variant?: "primary" | "secondary";
	errors?: Array<{ key?: string; value?: string }>;
	errorMessage?: string;
}

export function EnvEditor({
	value,
	onChange,
	variant,
	errors,
	errorMessage,
}: EnvEditorProps) {
	const { t } = useTranslation();

	// Import from clipboard
	const handleImportFromClipboard = async () => {
		try {
			const clipboardText = await navigator.clipboard.readText();
			if (!clipboardText.trim()) return;

			const parsed = dotenv.parse(clipboardText);
			const pairs = objectToKeyPairs(parsed);
			if (pairs.length > 0) {
				onChange(pairs);
			}
		} catch {
			// If parsing or clipboard read fails, do nothing
		}
	};

	return (
		<div className="space-y-2">
			<KeyPairEditor
				value={value}
				onChange={onChange}
				keyPlaceholder={t("envEditor.keyPlaceholder")}
				valuePlaceholder={t("envEditor.valuePlaceholder")}
				variant={variant}
				errors={errors}
				errorMessage={errorMessage}
			/>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onPress={handleImportFromClipboard}
			>
				<ClipboardDocumentIcon className="size-4" />
				{t("envEditor.importFromClipboard")}
			</Button>
		</div>
	);
}

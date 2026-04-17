import { ClipboardDocumentIcon } from "@heroicons/react/24/solid";
import { Button } from "@heroui/react";
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

const ENV_LINE_SPLIT_REGEX = /\r?\n/u;

function parseClipboardEnv(text: string): Record<string, string> {
	const env: Record<string, string> = {};

	for (const rawLine of text.split(ENV_LINE_SPLIT_REGEX)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}

		const content = line.startsWith("export ")
			? line.slice("export ".length).trim()
			: line;
		const equalsIndex = content.indexOf("=");

		if (equalsIndex <= 0) {
			continue;
		}

		const key = content.slice(0, equalsIndex).trim();
		if (!key) {
			continue;
		}

		let value = content.slice(equalsIndex + 1).trim();
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}

		env[key] = value;
	}

	return env;
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

			const parsed = parseClipboardEnv(clipboardText);
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

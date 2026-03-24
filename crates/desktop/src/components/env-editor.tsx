import {
	ClipboardDocumentIcon,
	PlusIcon,
	XMarkIcon,
} from "@heroicons/react/24/solid";
import { Button, Input } from "@heroui/react";
import * as dotenv from "dotenv";
import { produce } from "immer";
import { useTranslation } from "react-i18next";

export interface EnvVar {
	key: string;
	value: string;
}

interface EnvEditorProps {
	value: EnvVar[];
	onChange: (value: EnvVar[]) => void;
}

export function EnvEditor({ value, onChange }: EnvEditorProps) {
	const { t } = useTranslation();

	// Add new empty pair
	const handleAdd = () => {
		onChange(
			produce(value, (draft) => {
				draft.push({ key: "", value: "" });
			}),
		);
	};

	// Remove pair by index
	const handleRemove = (index: number) => {
		onChange(
			produce(value, (draft) => {
				draft.splice(index, 1);
			}),
		);
	};

	// Update pair by index
	const handleChange = (
		index: number,
		field: "key" | "value",
		newValue: string,
	) => {
		onChange(
			produce(value, (draft) => {
				draft[index][field] = newValue;
			}),
		);
	};

	// Import from clipboard
	const handleImportFromClipboard = async () => {
		try {
			const clipboardText = await navigator.clipboard.readText();
			if (!clipboardText.trim()) return;

			const parsed = dotenv.parse(clipboardText);
			const pairs = Object.entries(parsed).map(([key, value]) => ({
				key,
				value,
			}));
			if (pairs.length > 0) {
				onChange(pairs);
			}
		} catch {
			// If parsing or clipboard read fails, do nothing
		}
	};

	return (
		<div className="space-y-2">
			{value.map((pair, index) => (
				<div key={index} className="flex items-start gap-2">
					<Input
						variant="secondary"
						placeholder={t("envEditor.keyPlaceholder")}
						value={pair.key}
						onChange={(e) =>
							handleChange(index, "key", e.target.value)
						}
						className="flex-1"
					/>
					<Input
						variant="secondary"
						placeholder={t("envEditor.valuePlaceholder")}
						value={pair.value}
						onChange={(e) =>
							handleChange(index, "value", e.target.value)
						}
						className="flex-1"
					/>
					<Button
						variant="ghost"
						size="sm"
						isIconOnly
						onPress={() => handleRemove(index)}
						className="mt-1"
					>
						<XMarkIcon className="size-4" />
					</Button>
				</div>
			))}
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" onPress={handleAdd}>
					<PlusIcon className="size-4" />
					{t("envEditor.addKeypair")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onPress={handleImportFromClipboard}
				>
					<ClipboardDocumentIcon className="size-4" />
					{t("envEditor.importFromClipboard")}
				</Button>
			</div>
		</div>
	);
}

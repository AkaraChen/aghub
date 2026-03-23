import { useTranslation } from "react-i18next";
import { produce } from "immer";
import { Button, Input, Chip } from "@heroui/react";
import { XMarkIcon, PlusIcon } from "@heroicons/react/24/outline";
import * as dotenv from "dotenv";

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

	// Parse .env format on blur
	const handleKeyBlur = (keyValue: string) => {
		// Check if it looks like .env format
		if (keyValue.includes("=") || keyValue.includes("\n")) {
			try {
				const parsed = dotenv.parse(keyValue);
				const pairs = Object.entries(parsed).map(([key, value]) => ({
					key,
					value,
				}));
				if (pairs.length > 0) {
					onChange(pairs);
				}
			} catch (e) {
				// If parsing fails, keep the value as-is
			}
		}
	};

	return (
		<div className="space-y-2">
			{value.map((pair, index) => (
				<div key={index} className="flex gap-2 items-start">
					<Input
						variant="secondary"
						placeholder={t("envEditor.keyPlaceholder")}
						value={pair.key}
						onChange={(e) => handleChange(index, "key", e.target.value)}
						onBlur={(e) => handleKeyBlur(e.target.value)}
						className="flex-1"
					/>
					<Input
						variant="secondary"
						placeholder={t("envEditor.valuePlaceholder")}
						value={pair.value}
						onChange={(e) => handleChange(index, "value", e.target.value)}
						className="flex-1"
					/>
					<Button
						variant="ghost"
						size="sm"
						isIconOnly
						onPress={() => handleRemove(index)}
						className="mt-1"
					>
						<XMarkIcon className="w-4 h-4" />
					</Button>
				</div>
			))}
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" onPress={handleAdd}>
					<PlusIcon className="w-4 h-4" />
					{t("envEditor.addKeypair")}
				</Button>
				<Chip variant="tertiary" color="default" size="sm">
					{t("envEditor.supportsEnvPaste")}
				</Chip>
			</div>
		</div>
	);
}
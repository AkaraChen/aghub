import { PlusIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { Button, Input } from "@heroui/react";
import { produce } from "immer";
import { useTranslation } from "react-i18next";
import type { KeyPair } from "../lib/key-pair-utils";
import { generateId } from "../lib/key-pair-utils";

export type { KeyPair };

interface KeyPairEditorProps {
	value: KeyPair[];
	onChange: (value: KeyPair[]) => void;
	keyPlaceholder?: string;
	valuePlaceholder?: string;
}

export function KeyPairEditor({
	value,
	onChange,
	keyPlaceholder,
	valuePlaceholder,
}: KeyPairEditorProps) {
	const { t } = useTranslation();

	// Add new empty pair
	const handleAdd = () => {
		onChange(
			produce(value, (draft) => {
				draft.push({ id: generateId(), key: "", value: "" });
			}),
		);
	};

	// Remove pair by id
	const handleRemove = (id: string) => {
		onChange(
			produce(value, (draft) => {
				const index = draft.findIndex((item) => item.id === id);
				if (index !== -1) {
					draft.splice(index, 1);
				}
			}),
		);
	};

	// Update pair by id, or add new pair if empty
	const handleChange = (
		id: string,
		field: "key" | "value",
		newValue: string,
	) => {
		// If value array is empty, add a new pair
		if (value.length === 0) {
			const newPair = { id: generateId(), key: "", value: "" };
			newPair[field] = newValue;
			onChange([newPair]);
			return;
		}

		onChange(
			produce(value, (draft) => {
				const item = draft.find((item) => item.id === id);
				if (item) {
					item[field] = newValue;
				}
			}),
		);
	};

	// Show a default empty row when value is empty
	const displayPairs =
		value.length === 0 ? [{ id: "empty", key: "", value: "" }] : value;

	return (
		<div className="space-y-2">
			{displayPairs.map((pair) => (
				<div key={pair.id} className="flex items-start gap-2">
					<Input
						placeholder={
							keyPlaceholder || t("keyPairEditor.keyPlaceholder")
						}
						aria-label={
							keyPlaceholder || t("keyPairEditor.keyPlaceholder")
						}
						value={pair.key}
						onChange={(e) =>
							handleChange(pair.id, "key", e.target.value)
						}
						className="flex-1"
					/>
					<Input
						placeholder={
							valuePlaceholder ||
							t("keyPairEditor.valuePlaceholder")
						}
						aria-label={
							valuePlaceholder ||
							t("keyPairEditor.valuePlaceholder")
						}
						value={pair.value}
						onChange={(e) =>
							handleChange(pair.id, "value", e.target.value)
						}
						className="flex-1"
					/>
					<Button
						variant="ghost"
						size="sm"
						isIconOnly
						aria-label={t("remove")}
						onPress={() => handleRemove(pair.id)}
						className="mt-1"
						isDisabled={value.length === 0}
					>
						<XMarkIcon className="size-4" />
					</Button>
				</div>
			))}
			<Button variant="secondary" size="sm" onPress={handleAdd}>
				<PlusIcon className="size-4" />
				{t("keyPairEditor.addPair")}
			</Button>
		</div>
	);
}

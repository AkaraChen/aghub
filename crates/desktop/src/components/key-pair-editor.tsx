import { PlusIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { Button, ErrorMessage, Input } from "@heroui/react";
import { produce } from "immer";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { KeyPair } from "../lib/key-pair-utils";
import { generateId } from "../lib/key-pair-utils";

const EMPTY_ERRORS: Array<{ key?: string; value?: string }> = [];

interface KeyPairEditorProps {
	value: KeyPair[];
	onChange: (value: KeyPair[]) => void;
	keyPlaceholder?: string;
	valuePlaceholder?: string;
	variant?: "primary" | "secondary";
	errors?: Array<{ key?: string; value?: string }>;
	errorMessage?: string;
}

export function KeyPairEditor({
	value,
	onChange,
	keyPlaceholder,
	valuePlaceholder,
	variant,
	errors = EMPTY_ERRORS,
	errorMessage,
}: KeyPairEditorProps) {
	const { t } = useTranslation();
	const emptyPairIdRef = useRef(generateId());

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
			const newPair = {
				id: emptyPairIdRef.current,
				key: "",
				value: "",
			};
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
		value.length === 0
			? [
					{
						id: emptyPairIdRef.current,
						key: "",
						value: "",
					},
				]
			: value;

	void errors;

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
						variant={variant}
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
						variant={variant}
					/>
					<Button
						type="button"
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
			<Button
				type="button"
				variant="secondary"
				size="sm"
				onPress={handleAdd}
			>
				<PlusIcon className="size-4" />
				{t("keyPairEditor.addPair")}
			</Button>
			{errorMessage && <ErrorMessage>{errorMessage}</ErrorMessage>}
		</div>
	);
}

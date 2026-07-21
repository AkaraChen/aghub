import { FolderOpenIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Description,
	Input,
	Label,
	ListBox,
	NumberField,
	Select,
	Switch,
	TextField,
} from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SelectOption } from "./usage-setting-model";

/** Label + optional description on the left, a control on the right. */
export function SettingRow({
	title,
	description,
	control,
}: {
	title: string;
	description?: ReactNode;
	control: ReactNode;
}) {
	return (
		<div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
			<div className="min-w-0 space-y-0.5">
				<span className="text-sm font-medium text-(--foreground)">
					{title}
				</span>
				{description && (
					<div className="text-xs text-muted">{description}</div>
				)}
			</div>
			<div className="flex shrink-0 justify-end">{control}</div>
		</div>
	);
}

export function SettingSwitch({
	isSelected,
	onChange,
	ariaLabel,
	isDisabled,
}: {
	isSelected: boolean;
	onChange: (checked: boolean) => void;
	ariaLabel: string;
	isDisabled?: boolean;
}) {
	return (
		<Switch
			isSelected={isSelected}
			onChange={onChange}
			isDisabled={isDisabled}
			aria-label={ariaLabel}
		>
			<Switch.Content aria-label={ariaLabel}>
				<Switch.Control>
					<Switch.Thumb />
				</Switch.Control>
			</Switch.Content>
		</Switch>
	);
}

export function SettingSelect({
	value,
	onChange,
	ariaLabel,
	options,
	isDisabled,
}: {
	value: string;
	onChange: (key: string) => void;
	ariaLabel: string;
	options: SelectOption[];
	isDisabled?: boolean;
}) {
	return (
		<Select
			variant="secondary"
			value={value}
			onChange={(key) => onChange(String(key))}
			isDisabled={isDisabled}
			aria-label={ariaLabel}
			className="min-w-32"
		>
			<Select.Trigger>
				<Select.Value>
					{({ selectedText }) => selectedText}
				</Select.Value>
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{options.map((opt) => (
						<ListBox.Item
							key={opt.id}
							id={opt.id}
							textValue={opt.label}
							isDisabled={opt.isDisabled}
						>
							<div className="flex min-w-0 flex-1 items-baseline justify-between gap-5">
								<Label className="min-w-0 truncate">
									{opt.label}
								</Label>
								{opt.description && (
									<Description className="shrink-0 tabular-nums">
										{opt.description}
									</Description>
								)}
							</div>
							<ListBox.ItemIndicator />
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}

/** A compact numeric setting; units and percentages come from the field's
 *  Intl format options ("30d", "60s", "80%"), stepping from the buttons. */
export function SettingNumber({
	value,
	onChange,
	ariaLabel,
	minValue = 0,
	maxValue,
	step,
	formatOptions,
	isDisabled,
}: {
	value: number;
	onChange: (n: number) => void;
	ariaLabel: string;
	minValue?: number;
	maxValue?: number;
	step?: number;
	formatOptions?: Intl.NumberFormatOptions;
	isDisabled?: boolean;
}) {
	return (
		<NumberField
			variant="secondary"
			value={value}
			onChange={(n) => {
				if (Number.isFinite(n)) onChange(n);
			}}
			minValue={minValue}
			maxValue={maxValue}
			step={step}
			formatOptions={formatOptions}
			isDisabled={isDisabled}
			aria-label={ariaLabel}
		>
			<NumberField.Group className="w-36">
				<NumberField.DecrementButton />
				<NumberField.Input className="text-center tabular-nums" />
				<NumberField.IncrementButton />
			</NumberField.Group>
		</NumberField>
	);
}

/** A file-path setting with a native picker and an empty-value reset. */
export function PathField({
	label,
	value,
	onChange,
	placeholder,
	hint,
	filters,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	hint?: string;
	/** File-dialog extension filters; omit to accept any file. */
	filters?: { name: string; extensions: string[] }[];
}) {
	const { t } = useTranslation();
	const browse = async () => {
		const selected = await open({
			directory: false,
			multiple: false,
			filters,
		});
		if (typeof selected === "string") onChange(selected);
	};
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium text-(--foreground)">
					{label}
				</span>
				{value && (
					<Button
						size="sm"
						variant="ghost"
						onPress={() => onChange("")}
						className="h-7 px-2 text-xs text-muted"
					>
						{t("usagePathReset")}
					</Button>
				)}
			</div>
			<div className="flex items-center gap-2">
				<TextField
					variant="secondary"
					value={value}
					onChange={onChange}
					aria-label={label}
					className="flex-1"
				>
					<Input variant="secondary" placeholder={placeholder} />
				</TextField>
				<Button
					variant="secondary"
					size="sm"
					onPress={browse}
					className="shrink-0"
				>
					<FolderOpenIcon className="size-4" />
					{t("usagePathBrowse")}
				</Button>
			</div>
			{hint && <span className="text-xs text-muted">{hint}</span>}
		</div>
	);
}

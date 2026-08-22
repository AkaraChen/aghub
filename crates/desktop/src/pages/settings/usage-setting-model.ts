import type { UsageSettings } from "../../lib/store";

type UsageSettingsUpdate = (
	apply: (current: UsageSettings) => UsageSettings,
) => void;

export interface UsageSectionProps {
	current: UsageSettings;
	updateSettings: UsageSettingsUpdate;
}

export interface SelectOption {
	id: string;
	label: string;
	description?: string;
	isDisabled?: boolean;
}

export function includeSelectedOption(
	options: SelectOption[],
	id: string,
	label: string,
): SelectOption[] {
	return options.some((option) => option.id === id)
		? options
		: [{ id, label }, ...options];
}

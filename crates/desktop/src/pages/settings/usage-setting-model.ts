import type { UsageSettings } from "../../lib/store";

export const USAGE_AGENT_LABELS: Record<string, string> = {
	claude: "Claude",
	codex: "Codex",
	opencode: "OpenCode",
	amp: "Amp",
	droid: "Droid",
	codebuff: "Codebuff",
	hermes: "Hermes",
	pi: "Pi",
	goose: "Goose",
	kilo: "Kilo",
	copilot: "Copilot",
	gemini: "Gemini",
	kimi: "Kimi",
	qwen: "Qwen",
	openclaw: "OpenClaw",
};

export type UsageSettingsUpdate = (
	apply: (current: UsageSettings) => UsageSettings,
) => void;

export interface UsageSectionProps {
	current: UsageSettings;
	updateSettings: UsageSettingsUpdate;
}

export interface SelectOption {
	id: string;
	label: string;
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

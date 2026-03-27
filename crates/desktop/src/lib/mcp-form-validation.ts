import type { TFunction } from "i18next";
import type { EnvVar } from "../components/env-editor";
import type { HttpHeader } from "../components/http-header-editor";

export type McpTransportType = "stdio" | "sse" | "streamable_http";

interface KeyPairError {
	key?: string;
	value?: string;
}

export interface McpFormErrors {
	name?: string;
	command?: string;
	url?: string;
	timeout?: string;
	agents?: string;
	envVars: KeyPairError[];
	httpHeaders: KeyPairError[];
}

interface ValidateMcpFormInput {
	name: string;
	transportType: McpTransportType;
	command: string;
	url: string;
	timeoutValue: string;
	selectedAgents?: Set<string>;
	envVars: EnvVar[];
	httpHeaders: HttpHeader[];
}

export function validateName(t: TFunction, name: string): string | undefined {
	if (!name.trim()) return t("validationNameRequired");
	return undefined;
}

export function validateCommand(
	t: TFunction,
	transportType: McpTransportType,
	command: string,
): string | undefined {
	if (transportType !== "stdio") return undefined;
	if (!command.trim()) return t("validationCommandRequired");
	return undefined;
}

export function validateUrl(
	t: TFunction,
	transportType: McpTransportType,
	url: string,
): string | undefined {
	if (transportType === "stdio") return undefined;
	if (!url.trim()) return t("validationUrlRequired");

	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return t("validationUrlProtocol");
		}
	} catch {
		return t("validationUrlInvalid");
	}

	return undefined;
}

export function validateTimeout(
	t: TFunction,
	timeoutValue: string,
): string | undefined {
	if (!timeoutValue.trim()) return undefined;

	if (!/^\d+$/.test(timeoutValue)) {
		return t("validationTimeoutPositiveInteger");
	}

	const timeout = Number.parseInt(timeoutValue, 10);
	if (timeout <= 0) return t("validationTimeoutPositiveInteger");
	return undefined;
}

function validateKeyPairs(
	t: TFunction,
	pairs: Array<{ key: string; value: string }>,
): KeyPairError[] {
	const errors = pairs.map(() => ({}));
	const seenKeys = new Map<string, number[]>();

	pairs.forEach((pair, index) => {
		const key = pair.key.trim();
		const value = pair.value.trim();

		if (!key && !value) return;
		if (!key) {
			errors[index].key = t("validationKeyRequired");
			return;
		}
		if (!value) {
			errors[index].value = t("validationValueRequired");
			return;
		}

		const keyIndices = seenKeys.get(key) ?? [];
		keyIndices.push(index);
		seenKeys.set(key, keyIndices);
	});

	for (const indices of seenKeys.values()) {
		if (indices.length < 2) continue;
		for (const index of indices) {
			errors[index].key = t("validationDuplicateKey");
		}
	}

	return errors;
}

export function validateMcpForm(
	t: TFunction,
	input: ValidateMcpFormInput,
): McpFormErrors {
	return {
		name: validateName(t, input.name),
		command: validateCommand(t, input.transportType, input.command),
		url: validateUrl(t, input.transportType, input.url),
		timeout: validateTimeout(t, input.timeoutValue),
		agents:
			input.selectedAgents !== undefined &&
			input.selectedAgents.size === 0
				? t("validationAgentsRequired")
				: undefined,
		envVars: validateKeyPairs(t, input.envVars),
		httpHeaders: validateKeyPairs(t, input.httpHeaders),
	};
}

export function hasMcpFormErrors(errors: McpFormErrors): boolean {
	return Boolean(
		errors.name ||
			errors.command ||
			errors.url ||
			errors.timeout ||
			errors.agents ||
			errors.envVars.some((error) => error.key || error.value) ||
			errors.httpHeaders.some((error) => error.key || error.value),
	);
}

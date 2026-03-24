import type { EnvVar } from "../components/env-editor";
import type { TransportDto } from "./api-types";

// Static regex to avoid re-compilation on every call
const WHITESPACE_REGEX = /\s+/;

export function buildTransportFromForm(
	transportType: "stdio" | "sse" | "streamable_http",
	data: {
		command?: string;
		args?: string;
		envVars?: EnvVar[];
		url?: string;
		headers?: string;
		timeout?: string;
	},
): TransportDto | undefined {
	const timeoutNum = data.timeout
		? Number.parseInt(data.timeout, 10)
		: undefined;

	if (transportType === "stdio") {
		const argsArray = data.args?.trim()
			? data.args.trim().split(WHITESPACE_REGEX)
				: [];
		const envRecord: Record<string, string> | undefined =
			data.envVars && data.envVars.length > 0
				? Object.fromEntries(
						data.envVars.map((pair) => [pair.key, pair.value]),
					)
				: undefined;

		return {
			type: "stdio",
			command: data.command?.trim() ?? "",
			args: argsArray,
			env: envRecord,
			timeout: timeoutNum,
		};
	}

	const headersRecord: Record<string, string> | undefined =
		data.headers?.trim() ? parseHeaderText(data.headers) : undefined;

	return {
		type: transportType,
		url: data.url?.trim() ?? "",
		headers: headersRecord,
		timeout: timeoutNum,
	};
}

export function parseHeaderText(text: string): Record<string, string> {
	return Object.fromEntries(
		text
			.trim()
			.split("\n")
			.map((line) => {
				const colonIndex = line.indexOf(":");
				if (colonIndex === -1) return [line.trim(), ""];
				return [
					line.slice(0, colonIndex).trim(),
					line.slice(colonIndex + 1).trim(),
				];
			}),
	);
}

export function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function parseTimeout(timeout: string): number | undefined {
	return timeout ? Number.parseInt(timeout, 10) : undefined;
}

export function parseArgsString(args: string): string[] {
	return args.trim() ? args.trim().split(WHITESPACE_REGEX) : [];
}

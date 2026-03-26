import type { EnvVar } from "../components/env-editor";
import type { HttpHeader } from "../components/http-header-editor";
import type { TransportDto } from "./api-types";
import { keyPairToObject } from "./key-pair-utils";

// Static regex to avoid re-compilation on every call
const WHITESPACE_REGEX = /\s+/;

export function buildTransportFromForm(
	transportType: "stdio" | "sse" | "streamable_http",
	data: {
		command?: string;
		args?: string;
		envVars?: EnvVar[];
		url?: string;
		httpHeaders?: HttpHeader[];
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
				? keyPairToObject(data.envVars)
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
		data.httpHeaders && data.httpHeaders.length > 0
			? keyPairToObject(data.httpHeaders)
			: undefined;

	return {
		type: transportType,
		url: data.url?.trim() ?? "",
		headers: headersRecord,
		timeout: timeoutNum,
	};
}

export function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

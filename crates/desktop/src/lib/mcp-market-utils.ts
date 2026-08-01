import type {
	CreateMcpRequest,
	MarketMcpInput,
	MarketMcpInstallMethod,
	MarketMcpKeyValue,
	MarketMcpServer,
	MarketMcpValue,
	TransportDto,
} from "../generated/dto";

export function initialMcpFieldValues(
	method: MarketMcpInstallMethod,
): Record<string, string> {
	return Object.fromEntries(
		method.inputs.map((input) => [input.id, input.default ?? ""]),
	);
}

export function invalidMcpInputIds(
	method: MarketMcpInstallMethod,
	values: Record<string, string>,
): Set<string> {
	return new Set(
		method.inputs
			.filter((input) => !isInputValid(input, values[input.id] ?? ""))
			.map((input) => input.id),
	);
}

function isInputValid(input: MarketMcpInput, value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return !input.is_required;
	if (input.choices.length > 0 && !input.choices.includes(value)) {
		return false;
	}
	if (input.format === "number") return Number.isFinite(Number(value));
	if (input.format === "boolean") {
		return trimmed === "true" || trimmed === "false";
	}
	return true;
}

export function redactedMcpFieldValues(
	method: MarketMcpInstallMethod,
	values: Record<string, string>,
): Record<string, string> {
	const redacted = { ...values };
	for (const input of method.inputs) {
		if (input.is_secret && redacted[input.id]) {
			redacted[input.id] = "••••••••";
		}
	}
	return redacted;
}

function resolveValue(
	value: MarketMcpValue,
	values: Record<string, string>,
): string {
	let resolved = value.template;
	for (const [placeholder, inputId] of Object.entries(value.variables)) {
		resolved = resolved.replaceAll(
			`{${placeholder}}`,
			values[inputId] ?? "",
		);
	}
	return resolved;
}

function collectKeyValues(
	fields: MarketMcpKeyValue[],
	values: Record<string, string>,
): Record<string, string> | null {
	const result: Record<string, string> = {};
	for (const field of fields) {
		const value = resolveValue(field.value, values);
		if (value.trim()) result[field.name] = value;
	}
	return Object.keys(result).length > 0 ? result : null;
}

function buildTransport(
	method: MarketMcpInstallMethod,
	values: Record<string, string>,
): TransportDto {
	const transport = method.transport;
	if (transport.type === "stdio") {
		const args = transport.args.flatMap((argument) => {
			const value = resolveValue(argument.value, values);
			if (!value.trim()) return [];
			return [argument.name ? `${argument.name}=${value}` : value];
		});
		return {
			type: "stdio",
			command: transport.command,
			args,
			env: collectKeyValues(transport.env, values),
			timeout: null,
		};
	}

	return {
		type: transport.type,
		url: resolveValue(transport.url, values),
		headers: collectKeyValues(transport.headers, values),
		timeout: null,
	};
}

export function buildMarketMcpRequest(
	server: MarketMcpServer,
	method: MarketMcpInstallMethod,
	values: Record<string, string>,
): CreateMcpRequest {
	return {
		name: server.suggested_name,
		transport: buildTransport(method, values),
		timeout: null,
	};
}

function valueMatchesTemplate(
	value: MarketMcpValue,
	installedValue: string,
): boolean {
	const variableNames = new Set(Object.keys(value.variables));
	if (variableNames.size === 0) return installedValue === value.template;

	const literals: string[] = [];
	const placeholderPattern = /\{(\w+)\}/g;
	let literalStart = 0;
	for (const match of value.template.matchAll(placeholderPattern)) {
		const name = match[1];
		if (!name || !variableNames.has(name)) continue;
		const index = match.index;
		literals.push(value.template.slice(literalStart, index));
		literalStart = index + match[0].length;
	}
	if (literals.length === 0) return installedValue === value.template;
	literals.push(value.template.slice(literalStart));
	if (literals.every((literal) => literal.length === 0)) return false;

	if (!installedValue.startsWith(literals[0] ?? "")) return false;
	let offset = literals[0]?.length ?? 0;
	for (const literal of literals.slice(1, -1)) {
		const index = installedValue.indexOf(literal, offset);
		if (index === -1) return false;
		offset = index + literal.length;
	}
	const suffix = literals.at(-1) ?? "";
	return (
		installedValue.length - suffix.length >= offset &&
		installedValue.endsWith(suffix)
	);
}

function packageIdentifier(method: MarketMcpInstallMethod): string | null {
	if (method.transport.type !== "stdio") return null;
	const separator = method.id.indexOf(":");
	if (separator === -1) return null;
	const registry = method.id.slice(0, separator);
	if (!["npm", "pypi", "nuget"].includes(registry)) return null;
	return method.id.slice(separator + 1) || null;
}

function argumentMatchesPackage(argument: string, identifier: string): boolean {
	return argument === identifier || argument.startsWith(`${identifier}@`);
}

function containsOrderedArguments(
	installed: string[],
	expected: string[],
): boolean {
	let expectedIndex = 0;
	for (const argument of installed) {
		if (argument === expected[expectedIndex]) expectedIndex += 1;
	}
	return expectedIndex === expected.length;
}

export function marketMcpMethodMatchesTransport(
	method: MarketMcpInstallMethod,
	installed: TransportDto,
): boolean {
	const market = method.transport;
	if (market.type !== installed.type) return false;
	if (market.type === "stdio" && installed.type === "stdio") {
		if (market.command !== installed.command) return false;
		const identifier = packageIdentifier(method);
		if (
			identifier &&
			!installed.args.some((argument) =>
				argumentMatchesPackage(argument, identifier),
			)
		) {
			return false;
		}
		const fixedArguments = market.args.flatMap((argument) => {
			if (Object.keys(argument.value.variables).length > 0) return [];
			const value = argument.value.template;
			if (!value.trim()) return [];
			if (identifier && argumentMatchesPackage(value, identifier))
				return [];
			return [argument.name ? `${argument.name}=${value}` : value];
		});
		return containsOrderedArguments(installed.args, fixedArguments);
	}
	if (market.type === "sse" && installed.type === "sse") {
		return valueMatchesTemplate(market.url, installed.url);
	}
	if (
		market.type === "streamable_http" &&
		installed.type === "streamable_http"
	) {
		return valueMatchesTemplate(market.url, installed.url);
	}
	return false;
}

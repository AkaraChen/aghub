import type {
	CreateMcpRequest,
	MarketMcpInput,
	MarketMcpKeyValue,
	MarketMcpServer,
	MarketMcpValue,
	TransportDto,
} from "../generated/dto";

export function initialMcpFieldValues(
	server: MarketMcpServer,
): Record<string, string> {
	return Object.fromEntries(
		server.inputs.map((input) => [input.id, input.default ?? ""]),
	);
}

export function invalidMcpInputIds(
	server: MarketMcpServer,
	values: Record<string, string>,
): Set<string> {
	return new Set(
		server.inputs
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
	server: MarketMcpServer,
	values: Record<string, string>,
): Record<string, string> {
	const redacted = { ...values };
	for (const input of server.inputs) {
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
	server: MarketMcpServer,
	values: Record<string, string>,
): TransportDto {
	const transport = server.transport;
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
	values: Record<string, string>,
): CreateMcpRequest {
	return {
		name: server.suggested_name,
		transport: buildTransport(server, values),
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

export function marketMcpMatchesTransport(
	server: MarketMcpServer,
	installed: TransportDto,
): boolean {
	const market = server.transport;
	if (market.type !== installed.type) return false;
	if (market.type === "stdio" && installed.type === "stdio") {
		if (market.command !== installed.command) return false;
		const fixedArguments = market.args.flatMap((argument) => {
			if (Object.keys(argument.value.variables).length > 0) return [];
			const value = argument.value.template;
			if (!value.trim()) return [];
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

import type {
	CreateMcpRequest,
	MarketMcpEnv,
	MarketMcpServer,
	TransportDto,
} from "../generated/dto";

/**
 * Collect the values the user will supply for a market entry's declared env
 * vars / headers, keyed by field name. Pre-populated with registry defaults.
 */
export function initialMcpFieldValues(
	server: MarketMcpServer,
): Record<string, string> {
	const fields = server.transport === "stdio" ? server.env : server.headers;
	const values: Record<string, string> = {};
	for (const field of fields) {
		values[field.name] = field.value ?? "";
	}
	return values;
}

function collectValues(
	fields: MarketMcpEnv[],
	values: Record<string, string>,
): Record<string, string> | null {
	const result: Record<string, string> = {};
	for (const field of fields) {
		const value = values[field.name] ?? field.value ?? "";
		if (value.trim()) result[field.name] = value;
	}
	return Object.keys(result).length > 0 ? result : null;
}

function buildTransport(
	server: MarketMcpServer,
	values: Record<string, string>,
): TransportDto {
	if (server.transport === "stdio") {
		return {
			type: "stdio",
			command: server.command ?? "",
			args: server.args,
			env: collectValues(server.env, values),
			timeout: null,
		};
	}

	return {
		type: server.transport === "sse" ? "sse" : "streamable_http",
		url: server.url ?? "",
		headers: collectValues(server.headers, values),
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

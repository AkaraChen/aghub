import type { MarketMcpTransport } from "../../generated/dto";

export function mcpTransportLabel(type: MarketMcpTransport["type"]): string {
	switch (type) {
		case "streamable_http":
			return "Streamable HTTP";
		case "sse":
			return "SSE";
		case "stdio":
			return "stdio";
	}
}

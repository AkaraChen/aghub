import { describe, expect, it } from "vitest";
import type {
	MarketMcpInstallMethod,
	MarketMcpValue,
	TransportDto,
} from "../generated/dto";
import { marketMcpMethodMatchesTransport } from "./mcp-market-utils";

const EMPTY_INPUTS: MarketMcpInstallMethod["inputs"] = [];

function remoteMethod(url: MarketMcpValue): MarketMcpInstallMethod {
	return {
		id: `streamable-http:${url.template}`,
		label: `Streamable HTTP · ${url.template}`,
		transport: { type: "streamable_http", url, headers: [] },
		inputs: EMPTY_INPUTS,
	};
}

function npmMethod(
	identifier: string,
	version: string,
): MarketMcpInstallMethod {
	return {
		id: `npm:${identifier}`,
		label: `npm · ${identifier}`,
		transport: {
			type: "stdio",
			command: "npx",
			args: [
				{
					name: null,
					value: { template: "-y", variables: {} },
				},
				{
					name: null,
					value: {
						template: `${identifier}@${version}`,
						variables: {},
					},
				},
			],
			env: [],
		},
		inputs: EMPTY_INPUTS,
	};
}

describe("marketMcpMethodMatchesTransport", () => {
	it("does not identify an arbitrary URL from a variable-only template", () => {
		const method = remoteMethod({
			template: "{baseUrl}",
			variables: { baseUrl: "remote.url.base-url" },
		});
		const installed: TransportDto = {
			type: "streamable_http",
			url: "https://unrelated.example/mcp",
			headers: null,
			timeout: null,
		};

		expect(marketMcpMethodMatchesTransport(method, installed)).toBe(false);
	});

	it("identifies an installed package across registry version updates", () => {
		const method = npmMethod("@acme/remote-demo", "2.0.0");
		const installed: TransportDto = {
			type: "stdio",
			command: "npx",
			args: ["-y", "@acme/remote-demo@1.0.0"],
			env: null,
			timeout: null,
		};

		expect(marketMcpMethodMatchesTransport(method, installed)).toBe(true);
	});

	it("does not identify a different package with the same launcher", () => {
		const method = npmMethod("@acme/remote-demo", "2.0.0");
		const installed: TransportDto = {
			type: "stdio",
			command: "npx",
			args: ["-y", "@acme/another-server@1.0.0"],
			env: null,
			timeout: null,
		};

		expect(marketMcpMethodMatchesTransport(method, installed)).toBe(false);
	});
});

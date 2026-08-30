import { describe, expect, it } from "vitest";
import type {
	MarketMcpInstallMethod,
	MarketMcpServer,
	MarketMcpValue,
	TransportDto,
} from "../generated/dto";
import {
	buildMarketMcpRequest,
	marketMcpMethodMatchesTransport,
} from "./mcp-market-utils";

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

describe("buildMarketMcpRequest", () => {
	it.each(["token$&suffix", "$$-$`-$'", "{tenant}"])(
		"preserves the literal input %s in headers",
		(token) => {
			const method = remoteMethod({
				template: "https://example.test/mcp",
				variables: {},
			});
			if (method.transport.type !== "streamable_http") {
				throw new Error("expected a remote method");
			}
			method.transport.headers = [
				{
					name: "Authorization",
					value: {
						template: "Bearer {token}/{tenant}",
						variables: {
							token: "header.token",
							tenant: "header.tenant",
						},
					},
				},
			];
			const server: MarketMcpServer = {
				name: "io.example/remote",
				display_name: "Remote",
				suggested_name: "remote",
				publisher: "io.example",
				description: "Remote MCP",
				version: "1.0.0",
				repository_url: null,
				catalog_url: "https://registry.example.test/",
				install_methods: [method],
			};

			expect(
				buildMarketMcpRequest(server, method, {
					"header.token": token,
					"header.tenant": "acme",
				}).transport,
			).toMatchObject({
				headers: { Authorization: `Bearer ${token}/acme` },
			});
		},
	);
});

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

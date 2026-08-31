import { describe, expect, it, vi } from "vitest";
import type {
	MarketMcpInstallMethod,
	MarketMcpServer,
	MarketMcpValue,
	TransportDto,
} from "../generated/dto";
import {
	buildMarketMcpRequest,
	initialMcpFieldValues,
	marketMcpMethodMatchesTransport,
	redactedMcpFieldValues,
} from "./mcp-market-utils";

const EMPTY_INPUTS: MarketMcpInstallMethod["inputs"] = [];

const OCI_ENV_NAMES = ["API_KEY", "REGION", "OPTIONAL_TOKEN"];
const OCI_METHOD: MarketMcpInstallMethod = {
	id: "oci:ghcr.io/example/mcp:1.0.0",
	label: "OCI · ghcr.io/example/mcp:1.0.0",
	transport: {
		type: "stdio",
		command: "docker",
		args: [
			...["run", "-i", "--rm"].map((template) => ({
				name: null,
				value: { template, variables: {} },
			})),
			...OCI_ENV_NAMES.map((name) => ({
				name: "--env",
				value: { template: name, variables: {} },
				requires_env: name,
			})),
			...["ghcr.io/example/mcp:1.0.0", "serve"].map((template) => ({
				name: null,
				value: { template, variables: {} },
			})),
		],
		env: OCI_ENV_NAMES.map((name) => ({
			name,
			value: { template: "{value}", variables: { value: name } },
		})),
	},
	inputs: OCI_ENV_NAMES.map((name) => ({
		id: name,
		label: name,
		default: name === "REGION" ? "eu-west-1" : null,
		placeholder: null,
		description: null,
		is_required: name === "API_KEY",
		is_secret: name !== "REGION",
		format: "string",
		choices: [],
	})),
};
const OCI_SERVER: MarketMcpServer = {
	name: "io.example/container",
	display_name: "Container",
	suggested_name: "container",
	publisher: "io.example",
	description: "Container MCP",
	version: "1.0.0",
	updated_at: null,
	published_at: null,
	repository_url: null,
	catalog_url: "https://registry.example.test/",
	install_methods: [OCI_METHOD],
};

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
	it.each(["", "   ", "optional-test-token"])(
		"forwards only configured OCI environment names for %j",
		(optionalToken) => {
			const values = {
				...initialMcpFieldValues(OCI_METHOD),
				API_KEY: "test-secret-$&-{value}",
				OPTIONAL_TOKEN: optionalToken,
			};
			const request = buildMarketMcpRequest(
				OCI_SERVER,
				OCI_METHOD,
				values,
			);
			expect(request.transport).toEqual({
				type: "stdio",
				command: "docker",
				args: [
					"run",
					"-i",
					"--rm",
					"--env=API_KEY",
					"--env=REGION",
					...(optionalToken.trim() ? ["--env=OPTIONAL_TOKEN"] : []),
					"ghcr.io/example/mcp:1.0.0",
					"serve",
				],
				env: {
					API_KEY: values.API_KEY,
					REGION: "eu-west-1",
					...(optionalToken.trim()
						? { OPTIONAL_TOKEN: optionalToken }
						: {}),
				},
				timeout: null,
			});
			expect(
				marketMcpMethodMatchesTransport(OCI_METHOD, request.transport),
			).toBe(true);
			const preview = buildMarketMcpRequest(
				OCI_SERVER,
				OCI_METHOD,
				redactedMcpFieldValues(OCI_METHOD, values),
			);
			expect(preview.transport).toMatchObject({
				args:
					request.transport.type === "stdio"
						? request.transport.args
						: [],
			});
			expect(JSON.stringify(preview)).not.toContain(values.API_KEY);
			if (optionalToken.trim())
				expect(JSON.stringify(preview)).not.toContain(optionalToken);
		},
	);

	it("does not forward ambient variables when OCI inputs are omitted", () => {
		vi.stubEnv("OPTIONAL_TOKEN", "host-test-token");
		try {
			const request = buildMarketMcpRequest(OCI_SERVER, OCI_METHOD, {});
			expect(request.transport).toMatchObject({
				args: [
					"run",
					"-i",
					"--rm",
					"ghcr.io/example/mcp:1.0.0",
					"serve",
				],
				env: null,
			});
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("resolves conditional arguments without depending on the launcher name", () => {
		if (OCI_METHOD.transport.type !== "stdio")
			throw new Error("expected stdio");
		const method = {
			...OCI_METHOD,
			transport: { ...OCI_METHOD.transport, command: "podman" },
		};
		expect(
			buildMarketMcpRequest(OCI_SERVER, method, { API_KEY: "test-token" })
				.transport,
		).toMatchObject({
			command: "podman",
			args: [
				"run",
				"-i",
				"--rm",
				"--env=API_KEY",
				"ghcr.io/example/mcp:1.0.0",
				"serve",
			],
			env: { API_KEY: "test-token" },
		});
	});

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
				updated_at: null,
				published_at: null,
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

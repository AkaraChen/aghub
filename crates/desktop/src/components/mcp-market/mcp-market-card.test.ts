import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
	MarketMcpInstallMethod,
	MarketMcpServer,
} from "../../generated/dto";
import {
	McpMarketCard,
	mcpMarketRepositoryKind,
	mcpMarketTransportTypes,
} from "./mcp-market-card";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en" },
	}),
}));

const EMPTY_INPUTS: MarketMcpInstallMethod["inputs"] = [];

function method(
	id: string,
	type: MarketMcpInstallMethod["transport"]["type"],
): MarketMcpInstallMethod {
	if (type === "stdio") {
		return {
			id,
			label: id,
			transport: { type, command: "example", args: [], env: [] },
			inputs: EMPTY_INPUTS,
		};
	}
	return {
		id,
		label: id,
		transport: {
			type,
			url: { template: "https://example.test/mcp", variables: {} },
			headers: [],
		},
		inputs: EMPTY_INPUTS,
	};
}

describe("mcpMarketRepositoryKind", () => {
	it("distinguishes GitHub repositories from other catalog sources", () => {
		expect(
			mcpMarketRepositoryKind(
				"https://github.com/github/github-mcp-server",
			),
		).toBe("github");
		expect(
			mcpMarketRepositoryKind("https://gitlab.com/getpositif/positif"),
		).toBe("other");
	});
});

describe("mcpMarketTransportTypes", () => {
	it("preserves catalog order while removing duplicate transport labels", () => {
		expect(
			mcpMarketTransportTypes([
				method("npm", "stdio"),
				method("remote", "streamable_http"),
				method("oci", "stdio"),
				method("events", "sse"),
			]),
		).toEqual(["stdio", "streamable_http", "sse"]);
	});
});

describe("mcp market card", () => {
	it("shows the full registry name, each transport, and the installed action", () => {
		const server: MarketMcpServer = {
			name: "io.github.acme/example-mcp-server",
			display_name: "Example",
			suggested_name: "example-mcp-server",
			publisher: "io.github.acme",
			description: "Example server",
			version: "2.0.1",
			updated_at: "2026-08-31T00:00:00Z",
			published_at: null,
			repository_url: "https://github.com/acme/example-mcp-server",
			catalog_url: "https://registry.modelcontextprotocol.io/",
			install_methods: [
				method("npm", "stdio"),
				method("remote", "streamable_http"),
				method("oci", "stdio"),
			],
		};

		const markup = renderToStaticMarkup(
			createElement(McpMarketCard, {
				server,
				installed: true,
				onAction: () => undefined,
			}),
		);

		expect(markup).toContain("io.github.acme/example-mcp-server");
		expect(markup).toContain("stdio");
		expect(markup).toContain("Streamable HTTP");
		expect(markup).toContain("button--secondary");
		expect(markup).toContain("marketMcpInstalled");
	});
});

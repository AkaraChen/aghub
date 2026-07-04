import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

const AGENTS = [
	{
		id: "claude",
		display_name: "Claude",
		capabilities: {
			skills: {
				scopes: { global: true, project: true },
				universal: false,
				mutable_global: true,
				mutable_project: true,
			},
			mcp: {
				scopes: { global: true, project: true },
				stdio: true,
				remote: true,
				enable_disable: false,
			},
			sub_agents: { scopes: { global: false, project: false } },
		},
		skills_paths: {
			global_read: ["/tmp/e2e/.claude/skills"],
			global_write: "/tmp/e2e/.claude/skills",
			project_read: [],
			project_write: null,
		},
	},
];

const AVAILABILITY = [
	{
		id: "claude",
		has_global_directory: true,
		has_cli: true,
		is_available: true,
	},
];

const skill = (name: string) => ({
	name,
	enabled: true,
	source_path: `/tmp/e2e/.claude/skills/${name}/SKILL.md`,
	canonical_path: `/tmp/e2e/.claude/skills/${name}`,
	description: `${name} description`,
	author: null,
	version: null,
	tools: [],
	source: "global",
	agent: "claude",
});

const SKILLS = [skill("react-pro"), skill("css-wizard"), skill("solo-skill")];

const lockEntry = (name: string, source: string) => ({
	name,
	source,
	sourceType: "github",
	sourceUrl: `https://github.com/${source.replace(/^github\//, "")}`,
	skillPath: null,
	skillFolderHash: "hash",
	installedAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	pluginName: null,
});

const GLOBAL_LOCK = {
	version: 1,
	skills: [
		lockEntry("react-pro", "github/AkaraChen/web-dev"),
		lockEntry("css-wizard", "github/AkaraChen/web-dev"),
	],
	lastSelectedAgents: null,
};

const mcp = (name: string) => ({
	name,
	enabled: true,
	transport: {
		type: "stdio",
		command: `/usr/bin/${name}`,
		args: [],
		env: {},
	},
	timeout: null,
	source: "global",
	agent: "claude",
});

const MCPS = [mcp("alpha-mcp"), mcp("beta-mcp")];

const SUB_AGENTS = [
	{
		name: "reviewer",
		description: "reviews code",
		instruction: "review",
		source_path: "/tmp/e2e/.claude/agents/reviewer.md",
		source: "global",
		agent: "claude",
	},
];

const plugin = (id: string, name: string, enabled: boolean) => ({
	id,
	name,
	version: "1.0.0",
	description: `${name} plugin`,
	enabled,
	source: "github",
	has_skills: false,
	has_hooks: false,
	has_mcp: false,
	source_info: { kind: "github", value: `AkaraChen/${id}` },
	scopes: [],
});

const PLUGINS = {
	plugins: [
		plugin("alpha", "alpha-plugin", true),
		plugin("beta", "beta-plugin", false),
	],
};

/**
 * Installs the Tauri IPC mock plus an HTTP mock for the desktop API
 * (baseUrl comes from the mocked start_server: port 45999).
 */
export async function installMocks(page: Page) {
	await page.addInitScript({
		path: path.join(here, "tauri-mock.js"),
	});

	await page.route("**/ph/**", (route) => route.abort());
	await page.route("https://*.posthog.com/**", (route) => route.abort());

	// A per-test mutable copy so an MCP edit (PUT) is reflected by the next
	// list fetch — the mergeKey changes with the transport.
	const mcps = MCPS.map((m) => ({ ...m }));

	await page.route("http://localhost:45999/api/v1/**", (route) => {
		const url = new URL(route.request().url());
		const p = url.pathname.replace("/api/v1", "");
		const method = route.request().method();
		const json = (body: unknown) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(body),
			});

		if (p === "/agents") return json(AGENTS);
		if (p === "/agents/availability") return json(AVAILABILITY);
		if (p === "/agents/all/skills") return json(SKILLS);
		if (p === "/agents/all/mcps") return json(mcps);
		if (p === "/agents/all/sub-agents") return json(SUB_AGENTS);
		if (p === "/plugins") return json(PLUGINS);
		if (p === "/skills/lock/global") return json(GLOBAL_LOCK);

		const putMcp = p.match(/^\/agents\/[^/]+\/mcps\/(.+)$/);
		if (method === "PUT" && putMcp) {
			const name = decodeURIComponent(putMcp[1]);
			const body = JSON.parse(route.request().postData() ?? "{}");
			const idx = mcps.findIndex((m) => m.name === name);
			if (idx !== -1 && body.transport) {
				mcps[idx] = { ...mcps[idx], transport: body.transport };
			}
			return json(mcps[idx] ?? {});
		}

		if (method === "GET") return json([]);
		return json({});
	});
}

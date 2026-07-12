import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

const agentInfo = (id: string, displayName: string) => ({
	id,
	display_name: displayName,
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
		global_read: [`/tmp/e2e/.${id}/skills`],
		global_write: `/tmp/e2e/.${id}/skills`,
		project_read: [],
		project_write: null,
	},
});

const AGENTS = [agentInfo("claude", "Claude"), agentInfo("cursor", "Cursor")];

const AVAILABILITY = [
	{
		id: "claude",
		has_global_directory: true,
		has_cli: true,
		is_available: true,
	},
	{
		id: "cursor",
		has_global_directory: true,
		has_cli: true,
		is_available: true,
	},
];

const skill = (name: string, agent = "claude") => ({
	name,
	enabled: true,
	source_path: `/tmp/e2e/.${agent}/skills/${name}/SKILL.md`,
	canonical_path: `/tmp/e2e/.${agent}/skills/${name}`,
	description: `${name} description`,
	author: null,
	version: null,
	tools: [],
	source: "global",
	agent,
});

const SKILLS = [
	skill("react-pro"),
	skill("css-wizard"),
	skill("solo-skill"),
	// A second source cluster ("alpha-pack") so section ordering — by name
	// and starred-first — is observable
	skill("arch-lint"),
	skill("api-forge"),
];

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
		lockEntry("arch-lint", "github/AkaraChen/alpha-pack"),
		lockEntry("api-forge", "github/AkaraChen/alpha-pack"),
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

	// Per-test mutable copies so mutations (MCP PUT, skills reconcile,
	// source install) are reflected by the next fetch.
	const mcps = MCPS.map((m) => ({ ...m }));
	const skills = SKILLS.map((s) => ({ ...s }));
	const globalLock = {
		...GLOBAL_LOCK,
		skills: GLOBAL_LOCK.skills.map((entry) => ({ ...entry })),
	};

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
		if (p === "/agents/all/skills") return json(skills);
		if (p === "/agents/all/mcps") return json(mcps);
		if (p === "/agents/all/sub-agents") return json(SUB_AGENTS);
		if (p === "/plugins") return json(PLUGINS);
		if (p === "/skills/lock/global") return json(globalLock);

		if (p === "/skills/tree") {
			const treePath = url.searchParams.get("path") ?? "";
			const base = treePath.split("/").filter(Boolean).pop() ?? "skill";
			return json({
				name: base,
				path: treePath,
				kind: "directory",
				children: [
					{
						name: "SKILL.md",
						path: `${treePath}/SKILL.md`,
						kind: "file",
						children: [],
					},
					{
						name: "scripts",
						path: `${treePath}/scripts`,
						kind: "directory",
						children: [
							{
								name: "run.sh",
								path: `${treePath}/scripts/run.sh`,
								kind: "file",
								children: [],
							},
						],
					},
				],
			});
		}

		if (p === "/skills/git/scan" && method === "POST") {
			// The repo holds the two installed members plus one new skill
			const entry = (name: string) => ({
				name,
				description: `${name} description`,
				author: null,
				version: null,
				path: `skills/${name}`,
			});
			return json({
				session_id: "scan-session-1",
				branches: ["main"],
				current_branch: "main",
				skills: [
					entry("arch-lint"),
					entry("api-forge"),
					entry("fresh-skill"),
				],
			});
		}

		if (p === "/skills/git/install" && method === "POST") {
			// Install semantics: skip already-installed skills, add new
			// ones to the list AND the lock
			const body = JSON.parse(route.request().postData() ?? "{}");
			const results = [];
			for (const skillPath of body.skill_paths ?? []) {
				const name = String(skillPath).split("/").pop() ?? "";
				if (!skills.some((s) => s.name === name)) {
					skills.push(skill(name));
					globalLock.skills.push(
						lockEntry(name, "github/AkaraChen/alpha-pack"),
					);
				}
				for (const agent of body.agents ?? []) {
					results.push({ name, agent, success: true, error: null });
				}
			}
			return json({ results });
		}

		if (p === "/skills/reconcile" && method === "POST") {
			const body = JSON.parse(route.request().postData() ?? "{}");
			const name: string = body.source?.name ?? "";
			for (const agent of body.added ?? []) {
				if (!skills.some((s) => s.name === name && s.agent === agent)) {
					skills.push(skill(name, agent));
				}
			}
			for (const agent of body.removed ?? []) {
				const idx = skills.findIndex(
					(s) => s.name === name && s.agent === agent,
				);
				if (idx !== -1) skills.splice(idx, 1);
			}
			const changed =
				(body.added?.length ?? 0) + (body.removed?.length ?? 0);
			return json({
				success_count: changed,
				failed_count: 0,
				results: [],
			});
		}

		const putMcp = p.match(/^\/agents\/[^/]+\/mcps\/(.+)$/);
		if (method === "PUT" && putMcp) {
			const name = decodeURIComponent(putMcp[1] ?? "");
			const body = JSON.parse(route.request().postData() ?? "{}");
			const idx = mcps.findIndex((m) => m.name === name);
			const existing = idx === -1 ? undefined : mcps[idx];
			if (existing && body.transport) {
				mcps[idx] = { ...existing, transport: body.transport };
			}
			return json(mcps[idx] ?? {});
		}

		if (method === "GET") return json([]);
		return json({});
	});
}

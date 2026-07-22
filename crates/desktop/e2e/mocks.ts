import path from "node:path";
import process from "node:process";
import type { Page } from "@playwright/test";
import type {
	GitSyncRequest,
	SkillCopyResolutionRequest,
	SkillCopyStatusRequest,
	SkillDiffRequest,
	SkillDirectoryDiffResponse,
	SkillResponse,
} from "../src/generated/dto";

const here = path.join(process.cwd(), "e2e");

export const agentInfo = (id: string, displayName: string) => ({
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

const AGENTS = [
	agentInfo("claude", "Claude"),
	agentInfo("cursor", "Cursor"),
	// A third agent nothing is installed on, so bulk-manage tests can
	// "add to a new agent" without touching claude/cursor coverage.
	agentInfo("gemini", "Gemini"),
];

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
	{
		id: "gemini",
		has_global_directory: true,
		has_cli: true,
		is_available: true,
	},
];

const skill = (name: string, agent = "claude"): SkillResponse => ({
	name,
	enabled: true,
	source_path: `/tmp/e2e/.${agent}/skills/${name}/SKILL.md`,
	is_symlink: false,
	description: `${name} description`,
	author: null,
	version: null,
	tools: [],
	source: "global",
	agent,
});

const SKILLS = [
	skill("react-pro"),
	// react-pro is ALSO installed on cursor so a bulk selection of
	// react-pro + solo-skill has heterogeneous agent coverage (the list
	// still groups by name, so the visible item count stays at 5)
	skill("react-pro", "cursor"),
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
	const skillDiffs = new Map<string, SkillDirectoryDiffResponse>();
	const skillDiffErrors = new Set<string>();
	const skillDiffRequests: SkillDiffRequest[] = [];
	let skillDiffDelayMs = 0;
	const skillCopyStatuses = new Map<string, boolean>();
	const skillCopyStatusRequests: SkillCopyStatusRequest[] = [];
	const gitSyncRequests: GitSyncRequest[] = [];
	const skillCopyResolutionRequests: SkillCopyResolutionRequest[] = [];
	const skillDiffFor = (
		request: SkillDiffRequest,
		installedPath: string,
	): SkillDirectoryDiffResponse | null => {
		const referenceKey =
			request.reference.kind === "git_scan"
				? `git:${request.reference.skill_path}`
				: request.reference.source_path;
		const exactKey = `${installedPath}|${referenceKey}`;
		if (
			skillDiffErrors.has(exactKey) ||
			skillDiffErrors.has(installedPath)
		) {
			return null;
		}
		return (
			skillDiffs.get(exactKey) ??
			skillDiffs.get(installedPath) ??
			skillDiffs.get(referenceKey) ?? {
				identical: true,
				base_hash: "same",
				target_hash: "same",
				files: [],
				files_omitted: 0,
			}
		);
	};
	const observedSkillHash = (sourcePath: string): string | undefined => {
		for (let index = skillDiffRequests.length - 1; index >= 0; index -= 1) {
			const request = skillDiffRequests[index];
			if (!request) continue;
			if (
				request.reference.kind === "installed" &&
				request.reference.source_path === sourcePath
			) {
				for (const installedPath of request.installed_paths) {
					const comparison = skillDiffFor(request, installedPath);
					if (comparison) return comparison.base_hash;
				}
			}
			if (request.installed_paths.includes(sourcePath)) {
				const comparison = skillDiffFor(request, sourcePath);
				if (comparison) return comparison.target_hash;
			}
		}
		return undefined;
	};

	await page.route("http://localhost:45999/api/v1/**", async (route) => {
		const url = new URL(route.request().url());
		const p = url.pathname.replace("/api/v1", "");
		const method = route.request().method();
		const json = (body: unknown) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		const jsonError = (status: number, code: string, error: string) =>
			route.fulfill({
				status,
				contentType: "application/json",
				body: JSON.stringify({ code, error }),
			});

		if (p === "/agents") return json(AGENTS);
		if (p === "/agents/availability") return json(AVAILABILITY);
		if (p === "/agents/all/skills") return json(skills);
		if (p === "/agents/all/mcps") return json(mcps);
		if (p === "/agents/all/sub-agents") return json(SUB_AGENTS);
		if (p === "/plugins") return json(PLUGINS);
		if (p === "/skills/lock/global") return json(globalLock);
		if (p === "/skills/lock/project")
			return json({ version: 1, skills: [], lastSelectedAgents: null });
		if (p === "/skills/content") return json("# Skill\n\ncontent");
		if (p === "/skills/diff" && method === "POST") {
			const body = JSON.parse(
				route.request().postData() ?? "{}",
			) as SkillDiffRequest;
			skillDiffRequests.push(body);
			if (skillDiffDelayMs > 0) {
				await new Promise((resolve) =>
					setTimeout(resolve, skillDiffDelayMs),
				);
			}
			const results = body.installed_paths.map((installedPath) =>
				skillDiffFor(body, installedPath),
			);
			return json({ results });
		}
		if (p === "/skills/copies/status" && method === "POST") {
			const body = JSON.parse(
				route.request().postData() ?? "{}",
			) as SkillCopyStatusRequest;
			skillCopyStatusRequests.push(body);
			return json({
				results: body.groups.map((group) => ({
					name: group.name,
					has_differences: skillCopyStatuses.get(group.name) ?? false,
					unavailable: 0,
				})),
			});
		}
		if (p === "/integrations/code-editors") return json([]);

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
			const body = JSON.parse(route.request().postData() ?? "{}");
			const isWebDev = String(body.url ?? "").includes("web-dev");
			// Each source includes its installed members plus one new skill.
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
				skills: isWebDev
					? [
							entry("react-pro"),
							entry("css-wizard"),
							entry("fresh-skill"),
						]
					: [
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

		if (p === "/skills/git/sync" && method === "POST") {
			const body = JSON.parse(
				route.request().postData() ?? "{}",
			) as GitSyncRequest;
			gitSyncRequests.push(body);
			return json({ success: true, name: "react-pro", error: null });
		}

		if (p === "/skills/copies/resolve" && method === "POST") {
			const body = JSON.parse(
				route.request().postData() ?? "{}",
			) as SkillCopyResolutionRequest;
			skillCopyResolutionRequests.push(body);
			const referenceKey =
				body.reference.kind === "git_scan"
					? `git:${body.reference.skill_path}`
					: body.reference.source_path;
			if (body.scope === "all" && !body.project_root) {
				return jsonError(
					400,
					"MISSING_PARAM",
					"project_root is required when scope=all",
				);
			}

			const referenceHash = (() => {
				if (body.reference.kind === "git_scan") {
					const comparisonRequest = [...skillDiffRequests]
						.reverse()
						.find(
							(request) =>
								request.reference.kind === "git_scan" &&
								request.reference.session_id ===
									body.reference.session_id &&
								request.reference.skill_path ===
									body.reference.skill_path,
						);
					for (const installedPath of comparisonRequest?.installed_paths ??
						[]) {
						const comparison = comparisonRequest
							? skillDiffFor(comparisonRequest, installedPath)
							: null;
						if (comparison) return comparison.base_hash;
					}
					return undefined;
				}
				return observedSkillHash(body.reference.source_path) ?? "same";
			})();
			if (referenceHash !== body.expected_reference_hash) {
				return jsonError(
					409,
					"SKILL_COPY_CHANGED",
					"A skill copy changed after comparison",
				);
			}
			for (const target of body.targets) {
				const currentHash =
					observedSkillHash(target.source_path) ?? "same";
				if (currentHash !== target.expected_hash) {
					return jsonError(
						409,
						"SKILL_COPY_CHANGED",
						"A skill copy changed after comparison",
					);
				}
			}

			const identical = {
				identical: true,
				base_hash: body.expected_reference_hash,
				target_hash: body.expected_reference_hash,
				files: [],
				files_omitted: 0,
			} satisfies SkillDirectoryDiffResponse;
			for (const target of body.targets) {
				const key = `${target.source_path}|${referenceKey}`;
				if (body.reference.kind === "git_scan") {
					skillDiffs.set(key, identical);
				}
			}
			if (body.reference.kind === "installed") {
				const unifiedPaths = new Set([
					body.reference.source_path,
					...body.targets.map((target) => target.source_path),
				]);
				for (const [key, diff] of skillDiffs) {
					if (
						!key.includes("|") &&
						diff.target_hash === referenceHash
					) {
						unifiedPaths.add(key);
					}
				}
				const gitComparisons = Array.from(skillDiffs.entries()).filter(
					([key]) =>
						key.startsWith(`${body.reference.source_path}|git:`),
				);
				for (const sourcePath of unifiedPaths) {
					skillDiffs.set(sourcePath, identical);
					for (const [key, diff] of gitComparisons) {
						const suffix = key.slice(
							body.reference.source_path.length,
						);
						skillDiffs.set(`${sourcePath}${suffix}`, diff);
					}
				}
			}
			return json({
				name: "react-pro",
				reference_hash: body.expected_reference_hash,
				results: body.targets.map((target) => ({
					source_path: target.source_path,
					content_hash: body.expected_reference_hash,
				})),
			});
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

		const deleteSkill = p.match(/^\/agents\/([^/]+)\/skills\/(.+)$/);
		if (method === "DELETE" && deleteSkill) {
			const agent = deleteSkill[1] ?? "";
			const name = decodeURIComponent(deleteSkill[2] ?? "");
			for (let i = skills.length - 1; i >= 0; i--) {
				if (skills[i].name === name && skills[i].agent === agent) {
					skills.splice(i, 1);
				}
			}
			return json({});
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

		// An unmocked endpoint must fail loudly: an empty 200 would let
		// the suite stay green while the real app errors on a renamed or
		// missing route.
		console.warn(`[api-mock] unmocked route: ${method} ${p}`);
		return route.fulfill({
			status: 404,
			contentType: "application/json",
			body: JSON.stringify({
				error: `[api-mock] unmocked route: ${method} ${p}`,
			}),
		});
	});

	// Control handle so specs can mutate the mock state mid-test (e.g.
	// simulate reinstalling a deleted skill, made visible by a refetch).
	return {
		getSkillCopyStatusRequestCount() {
			return skillCopyStatusRequests.length;
		},
		getSkillCopyStatusRequests() {
			return [...skillCopyStatusRequests];
		},
		setSkillCopyStatus(name: string, hasDifferences: boolean) {
			skillCopyStatuses.set(name, hasDifferences);
		},
		getSkillCopyResolutionRequests() {
			return [...skillCopyResolutionRequests];
		},
		getGitSyncRequests() {
			return [...gitSyncRequests];
		},
		getSkillDiffRequests() {
			return [...skillDiffRequests];
		},
		setSkillDiff(key: string, diff: SkillDirectoryDiffResponse) {
			skillDiffs.set(key, diff);
		},
		setSkillDiffDelay(delayMs: number) {
			skillDiffDelayMs = delayMs;
		},
		setSkillDiffError(key: string) {
			skillDiffErrors.add(key);
		},
		addSkill(name: string, agent = "claude") {
			skills.push(skill(name, agent));
		},
		setSkillSymlink(name: string, agent: string) {
			const item = skills.find(
				(skill) => skill.name === name && skill.agent === agent,
			);
			if (!item) return;
			item.is_symlink = true;
			item.locations?.forEach((location) => {
				if (location.source_path === item.source_path) {
					location.is_symlink = true;
				}
			});
		},
		addProjectSkill(
			name: string,
			agent: string,
			projectSourcePath: string,
			globalSourcePaths: string[],
		) {
			const item = skill(name, agent);
			item.source = "project";
			item.source_path = projectSourcePath;
			item.is_symlink = false;
			item.locations = [
				{
					source_path: projectSourcePath,
					is_symlink: false,
					source: "project",
				},
				...globalSourcePaths.map((sourcePath) => ({
					source_path: sourcePath,
					is_symlink: false,
					source: "global" as const,
				})),
			];
			skills.push(item);
		},
		addSkillLocation(name: string, agent: string, sourcePath: string) {
			const item = skills.find(
				(skill) => skill.name === name && skill.agent === agent,
			);
			if (!item || !item.source_path || !item.source) return;
			item.locations ??= [
				{
					source_path: item.source_path,
					is_symlink: item.is_symlink,
					source: item.source,
				},
			];
			if (
				!item.locations.some(
					(location) => location.source_path === sourcePath,
				)
			) {
				item.locations.push({
					source_path: sourcePath,
					is_symlink: false,
					source: item.source,
				});
			}
		},
	};
}

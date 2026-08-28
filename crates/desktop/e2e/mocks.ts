import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type {
	CcusageRuntimeDto,
	CcusageRuntimeSource,
	CodexSkillDiscoveryResponse,
	CodexVisibleCopyRequest,
	GitSyncRequest,
	InstallCcusageRuntimeRequest,
	SetCcusageRuntimeRequest,
	SkillCopyResolutionRequest,
	SkillCopyStatusRequest,
	SkillDiffRequest,
	SkillDirectoryDiffResponse,
	SkillResponse,
} from "../src/generated/dto";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiPort = Number(process.env.AGHUB_E2E_API_PORT ?? "45999");

export function e2eApiUrl(pathname: string): string {
	return `http://localhost:${apiPort}/api/v1${pathname}`;
}

export const agentInfo = (
	id: string,
	displayName: string,
	universal = false,
) => ({
	id,
	display_name: displayName,
	capabilities: {
		skills: {
			scopes: { global: true, project: true },
			universal,
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
		global_read: universal
			? ["/tmp/e2e/.agents/skills", `/tmp/e2e/.${id}/skills`]
			: [`/tmp/e2e/.${id}/skills`],
		global_write: `/tmp/e2e/.${id}/skills`,
		project_read: universal ? [".agents/skills"] : [],
		project_write: null,
	},
});

const AGENTS = [
	agentInfo("claude", "Claude"),
	agentInfo("cursor", "Cursor"),
	// A third agent nothing is installed on, so bulk-manage tests can
	// "add to a new agent" without touching claude/cursor coverage.
	agentInfo("gemini", "Gemini", true),
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

const USAGE_AGENTS = [
	"claude",
	"codex",
	"opencode",
	"amp",
	"factory",
	"codebuff",
	"hermes",
	"pi",
	"goose",
	"kilocode",
	"copilot",
	"gemini",
	"kimi",
	"qwen",
	"openclaw",
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

const benignAudit = (contentDigest: string) => ({
	verdict: "benign" as const,
	confidence: "high" as const,
	findings: [],
	summary: "No unsafe behavior found",
	engine_version: "e2e",
	content_digest: contentDigest,
	assessment_digest: `assessment:${contentDigest}`,
	confirmation_required: false,
});

const auditDigest = (paths: unknown) =>
	`e2e:${Array.isArray(paths) ? [...paths].map(String).sort().join("|") : ""}`;

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

const RULE_FILES = [
	{
		agent: "claude",
		path: "~/.claude/CLAUDE.md",
		source: "global",
		exists: true,
	},
	{
		agent: "gemini",
		path: "~/.gemini/GEMINI.md",
		source: "global",
		exists: false,
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

const CCUSAGE_RUNTIME: CcusageRuntimeDto = {
	preference: "auto",
	active: {
		source: "bundled",
		path: "/Applications/aghub.app/Contents/Resources/ccusage",
		version: "20.0.6",
		can_update: true,
	},
	candidates: [
		{
			source: "path",
			installed: false,
			path: null,
			version: null,
			can_install: false,
		},
		{
			source: "bun",
			installed: false,
			path: null,
			version: null,
			can_install: true,
		},
		{
			source: "npm",
			installed: false,
			path: null,
			version: null,
			can_install: true,
		},
		{
			source: "download",
			installed: false,
			path: null,
			version: null,
			can_install: true,
		},
		{
			source: "bundled",
			installed: true,
			path: "/Applications/aghub.app/Contents/Resources/ccusage",
			version: "20.0.6",
			can_install: false,
		},
	],
	latest_version: "20.0.17",
	update_available: true,
	error: null,
};

/**
 * Installs the Tauri IPC mock plus an HTTP mock for the desktop API
 * (baseUrl comes from the mocked start_server).
 */
export async function installMocks(page: Page) {
	const tauriMock = readFileSync(path.join(here, "tauri-mock.js"), "utf8");
	await page.addInitScript({
		content: `window.__AGHUB_E2E_API_PORT__ = ${apiPort};\n${tauriMock}`,
	});

	await page.route("**/ph/**", (route) => route.abort());
	await page.route("https://*.posthog.com/**", (route) => route.abort());

	// Per-test mutable copies so mutations (MCP PUT, skills reconcile,
	// source install) are reflected by the next fetch.
	const agents = structuredClone(AGENTS);
	const availability = structuredClone(AVAILABILITY);
	const mcps = MCPS.map((m) => ({ ...m }));
	const skills = SKILLS.map((s) => ({ ...s }));
	const ruleFiles = RULE_FILES.map((rule) => ({ ...rule }));
	const ruleContent = new Map([
		["~/.claude/CLAUDE.md", "# Existing rules\n"],
	]);
	const ruleVersions = new Map([
		[
			"~/.claude/CLAUDE.md",
			[
				{
					content: "# Previous rules\n",
					revision: "e2e:previous",
					created_at: Date.UTC(2026, 6, 1, 8, 0),
				},
			],
		],
	]);
	let ruleVersionPreferences = {
		enabled: true,
		max_versions_per_file: 20,
	};
	let clearedRuleVersionCount = 0;
	let codexProvidedSkills: CodexSkillDiscoveryResponse = {
		skills: [],
		standalone_skills: [],
		errors: [],
	};
	const codexVisibleCopyRequests: CodexVisibleCopyRequest[] = [];
	const globalLock = {
		...GLOBAL_LOCK,
		skills: GLOBAL_LOCK.skills.map((entry) => ({ ...entry })),
	};
	const skillDiffs = new Map<string, SkillDirectoryDiffResponse>();
	const skillDiffErrors = new Set<string>();
	const skillDiffRequests: SkillDiffRequest[] = [];
	const skillTreeRequests: string[] = [];
	let skillDiffDelayMs = 0;
	const skillCopyStatuses = new Map<string, boolean>();
	const skillCopyStatusRequests: SkillCopyStatusRequest[] = [];
	const gitSyncRequests: GitSyncRequest[] = [];
	const skillCopyResolutionRequests: SkillCopyResolutionRequest[] = [];
	const gitScanSessions = new Set<string>();
	let expiredGitSessionRequestCount = 0;
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
	let ccusageRuntime: CcusageRuntimeDto = structuredClone(CCUSAGE_RUNTIME);

	await page.route(e2eApiUrl("/**"), async (route) => {
		const url = new URL(route.request().url());
		const p = url.pathname.replace("/api/v1", "");
		const method = route.request().method();
		const json = (body: unknown, status = 200) =>
			route.fulfill({
				status,
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		const jsonError = (status: number, code: string, error: string) =>
			route.fulfill({
				status,
				contentType: "application/json",
				body: JSON.stringify({ code, error }),
			});

		if (p === "/agents") return json(agents);
		if (p === "/agents/availability") return json(availability);
		if (p === "/agents/all/skills") return json(skills);
		if (p === "/skills/providers/codex/visible-copy" && method === "POST") {
			const body = JSON.parse(
				route.request().postData() ?? "{}",
			) as CodexVisibleCopyRequest;
			codexVisibleCopyRequests.push(body);
			codexProvidedSkills = {
				...codexProvidedSkills,
				standalone_skills: codexProvidedSkills.standalone_skills.map(
					(skill) =>
						skill.name === body.name
							? {
									...skill,
									enabled:
										body.mode === "all" ||
										skill.source_path === body.source_path,
								}
							: skill,
				),
			};
			return json(body);
		}
		if (p === "/skills/providers/codex") return json(codexProvidedSkills);
		if (p === "/agents/all/mcps") return json(mcps);
		if (p === "/agents/all/sub-agents") return json(SUB_AGENTS);
		if (p === "/agents/all/rules") return json(ruleFiles);
		if (p === "/prompts/storage") {
			return json({
				file_path:
					"C:\\Users\\demo\\AppData\\Roaming\\aghub\\prompts.json",
			});
		}
		if (p === "/prompts") return json([]);
		if (p === "/rules/versions/storage" && method === "GET") {
			return json({
				file_path:
					"C:\\Users\\demo\\AppData\\Roaming\\aghub\\rule-versions.json",
			});
		}
		if (p === "/rules/versions/preferences" && method === "GET") {
			return json({
				...ruleVersionPreferences,
				min_versions_per_file: 1,
				max_supported_versions_per_file: 100,
			});
		}
		if (p === "/rules/versions/preferences" && method === "PUT") {
			const body = JSON.parse(route.request().postData() ?? "{}");
			ruleVersionPreferences = {
				enabled: Boolean(body.enabled),
				max_versions_per_file: Number(body.max_versions_per_file),
			};
			for (const [path, versions] of ruleVersions) {
				ruleVersions.set(
					path,
					versions.slice(
						0,
						ruleVersionPreferences.max_versions_per_file,
					),
				);
			}
			return json({
				...ruleVersionPreferences,
				min_versions_per_file: 1,
				max_supported_versions_per_file: 100,
			});
		}
		if (p === "/rules/versions" && method === "DELETE") {
			ruleVersions.clear();
			clearedRuleVersionCount += 1;
			return route.fulfill({ status: 204 });
		}
		if (p === "/rules/content" && method === "GET") {
			const path = url.searchParams.get("path") ?? "";
			return json({
				path,
				content: ruleContent.get(path) ?? "",
				exists: ruleContent.has(path),
				revision: ruleRevision(ruleContent, path),
			});
		}
		if (p === "/rules/versions" && method === "GET") {
			const path = url.searchParams.get("path") ?? "";
			return json(ruleVersions.get(path) ?? []);
		}
		if (p === "/rules/content" && method === "PUT") {
			const body = JSON.parse(route.request().postData() ?? "{}");
			const path = String(body.path ?? "");
			const content = String(body.content ?? "");
			if (
				body.expected_revision !== null &&
				body.expected_revision !== undefined &&
				body.expected_revision !== ruleRevision(ruleContent, path)
			) {
				return json(
					{
						error: "Rule file changed after it was loaded",
						code: "RULE_FILE_CHANGED",
					},
					409,
				);
			}
			const currentContent = ruleContent.get(path);
			if (
				ruleVersionPreferences.enabled &&
				currentContent !== undefined &&
				currentContent !== content
			) {
				const versions = ruleVersions.get(path) ?? [];
				versions.unshift({
					content: currentContent,
					revision: ruleRevision(ruleContent, path),
					created_at: Date.now(),
				});
				ruleVersions.set(
					path,
					versions.slice(
						0,
						ruleVersionPreferences.max_versions_per_file,
					),
				);
			}
			ruleContent.set(path, content);
			const rule = ruleFiles.find((item) => item.path === path);
			if (rule) rule.exists = true;
			return json({
				path,
				content,
				exists: true,
				revision: ruleRevision(ruleContent, path),
			});
		}
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
			if (
				body.reference.kind === "git_scan" &&
				!gitScanSessions.has(body.reference.session_id)
			) {
				expiredGitSessionRequestCount += 1;
				return jsonError(
					404,
					"SESSION_NOT_FOUND",
					"Session not found or expired",
				);
			}
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
		if (p === "/usage/agents") return json(USAGE_AGENTS);
		if (p === "/usage/runtime" && method === "GET") {
			return json(ccusageRuntime);
		}
		if (p === "/usage/runtime" && method === "PUT") {
			const body = JSON.parse(
				route.request().postData() ?? "{}",
			) as SetCcusageRuntimeRequest;
			const candidate = ccusageRuntime.candidates.find(
				(item) => item.source === body.source,
			);
			ccusageRuntime = {
				...ccusageRuntime,
				preference: body.source,
				active:
					body.source !== "auto" &&
					candidate?.installed &&
					candidate.version
						? {
								source: body.source,
								path:
									candidate.path ??
									`/tmp/e2e/ccusage/${body.source}/ccusage`,
								version: candidate.version,
								can_update: false,
							}
						: ccusageRuntime.active,
			};
			return json(ccusageRuntime);
		}
		if (p === "/usage/runtime/refresh" && method === "POST") {
			return json(ccusageRuntime);
		}
		if (
			(p === "/usage/runtime/install" || p === "/usage/runtime/update") &&
			method === "POST"
		) {
			const request =
				p === "/usage/runtime/install"
					? (JSON.parse(
							route.request().postData() ?? "{}",
						) as InstallCcusageRuntimeRequest)
					: null;
			const requestedSource =
				request?.source ?? ccusageRuntime.active?.source ?? "auto";
			const installedSource: CcusageRuntimeSource =
				requestedSource === "auto" || requestedSource === "bundled"
					? "bun"
					: requestedSource;
			const installedVersion = ccusageRuntime.latest_version ?? "20.0.17";
			const installedPath = `/tmp/e2e/ccusage/installations/${installedSource}/${installedVersion}/ccusage`;
			ccusageRuntime = {
				...ccusageRuntime,
				preference: request?.source ?? ccusageRuntime.preference,
				active: {
					source: installedSource,
					path: installedPath,
					version: installedVersion,
					can_update: true,
				},
				candidates: ccusageRuntime.candidates.map((candidate) =>
					candidate.source === installedSource
						? {
								...candidate,
								installed: true,
								path: installedPath,
								version: installedVersion,
							}
						: candidate,
				),
				update_available: false,
			};
			return json(ccusageRuntime);
		}

		if (p === "/skills/audit" && method === "POST") {
			const body = JSON.parse(route.request().postData() ?? "{}");
			return json(benignAudit(auditDigest(body.paths)));
		}

		if (p === "/skills/tree") {
			const treePath = url.searchParams.get("path") ?? "";
			skillTreeRequests.push(treePath);
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
			if (body.session_id) {
				gitScanSessions.delete(String(body.session_id));
			}
			gitScanSessions.add("scan-session-1");
			// Each source includes its installed members plus one new skill.
			const entry = (name: string) => ({
				name,
				description: `${name} description`,
				author: null,
				version: null,
				path: `skills/${name}`,
				audit: body.skip_audit ? null : benignAudit(`e2e:scan:${name}`),
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
			const body = JSON.parse(route.request().postData() ?? "{}");
			const audit = body.skip_audit
				? null
				: benignAudit(auditDigest(body.skill_paths));
			if (body.audit_only) {
				return json({
					results: [],
					audit,
					audit_confirmation_required: false,
				});
			}

			// The write phase updates both the list and lock.
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
			gitScanSessions.delete(String(body.session_id));
			return json({
				results,
				audit,
				audit_confirmation_required: false,
			});
		}

		if (p === "/skills/install" && method === "POST") {
			const body = JSON.parse(route.request().postData() ?? "{}");
			return json({
				success: true,
				audit: body.skip_audit
					? null
					: benignAudit(auditDigest(body.skills)),
				audit_confirmation_required: false,
				session_id: body.audit_only ? "skills-sh-session-1" : null,
			});
		}

		const importSkill = p.match(/^\/agents\/([^/]+)\/skills\/import$/);
		if (method === "POST" && importSkill) {
			const agent = importSkill[1] ?? "claude";
			const body = JSON.parse(route.request().postData() ?? "{}");
			const importedName =
				String(body.path ?? "skill")
					.split("/")
					.filter(Boolean)
					.pop() ?? "skill";
			return json(skill(importedName, agent));
		}

		if (p === "/skills/git/sync" && method === "POST") {
			const body = JSON.parse(
				route.request().postData() ?? "{}",
			) as GitSyncRequest;
			gitSyncRequests.push(body);
			gitScanSessions.delete(body.session_id);
			return json({ success: true, name: "react-pro", error: null });
		}

		if (p === "/skills/copies/resolve" && method === "POST") {
			const body = JSON.parse(
				route.request().postData() ?? "{}",
			) as SkillCopyResolutionRequest;
			skillCopyResolutionRequests.push(body);
			if (
				body.reference.kind === "git_scan" &&
				!gitScanSessions.has(body.reference.session_id)
			) {
				expiredGitSessionRequestCount += 1;
				return jsonError(
					404,
					"SESSION_NOT_FOUND",
					"Session not found or expired",
				);
			}
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
			const audit =
				body.reference.kind === "git_scan"
					? benignAudit(`e2e:resolve:${referenceKey}`)
					: null;
			if (
				audit &&
				body.expected_content_digest &&
				body.expected_content_digest !== audit.content_digest
			) {
				return jsonError(
					409,
					"SKILL_AUDIT_CONTENT_CHANGED",
					"Skill content changed after security review",
				);
			}
			if (body.audit_only) {
				return json({
					name: "react-pro",
					reference_hash: body.expected_reference_hash,
					results: [],
					audit,
					audit_confirmation_required: false,
				});
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
			if (body.reference.kind === "git_scan") {
				gitScanSessions.delete(body.reference.session_id);
			}
			return json({
				name: "react-pro",
				reference_hash: body.expected_reference_hash,
				results: body.targets.map((target) => ({
					source_path: target.source_path,
					content_hash: body.expected_reference_hash,
				})),
				audit,
				audit_confirmation_required: false,
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
		setCodexProvidedSkills(response: CodexSkillDiscoveryResponse) {
			codexProvidedSkills = response;
			if (!agents.some((item) => item.id === "codex")) {
				agents.push(agentInfo("codex", "OpenAI Codex"));
			}
			if (!availability.some((item) => item.id === "codex")) {
				availability.push({
					id: "codex",
					has_global_directory: true,
					has_cli: true,
					is_available: true,
				});
			}
		},
		getCodexVisibleCopyRequests() {
			return [...codexVisibleCopyRequests];
		},
		getSkillTreeRequests() {
			return [...skillTreeRequests];
		},
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
		getExpiredGitSessionRequestCount() {
			return expiredGitSessionRequestCount;
		},
		hasGitScanSession(sessionId: string) {
			return gitScanSessions.has(sessionId);
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
		addSkill(name: string, agent = "claude", sourcePath?: string) {
			const item = skill(name, agent);
			if (sourcePath) item.source_path = sourcePath;
			skills.push(item);
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
		addAgent(id: string, displayName: string, universal = false) {
			if (!agents.some((agent) => agent.id === id)) {
				agents.push(agentInfo(id, displayName, universal));
			}
			if (!availability.some((agent) => agent.id === id)) {
				availability.push({
					id,
					has_global_directory: true,
					has_cli: true,
					is_available: true,
				});
			}
		},
		setRuleContent(path: string, content: string) {
			ruleContent.set(path, content);
			const rule = ruleFiles.find((item) => item.path === path);
			if (rule) rule.exists = true;
		},
		getRuleContent(path: string) {
			return ruleContent.get(path);
		},
		getClearedRuleVersionCount() {
			return clearedRuleVersionCount;
		},
		getRuleVersionPreferences() {
			return { ...ruleVersionPreferences };
		},
	};
}

function ruleRevision(ruleContent: Map<string, string>, path: string) {
	return JSON.stringify({
		exists: ruleContent.has(path),
		content: ruleContent.get(path) ?? "",
	});
}

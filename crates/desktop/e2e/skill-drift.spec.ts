import { expect, test, type Page } from "@playwright/test";
import type { SkillDirectoryDiffResponse } from "../src/generated/dto";
import { agentInfo, installMocks } from "./mocks";

const modifiedSkillDiff: SkillDirectoryDiffResponse = {
	identical: false,
	base_hash: "base",
	target_hash: "target",
	files: [
		{
			path: "SKILL.md",
			change: "modified",
			before: "# Skill\n\nold instruction\n",
			after: "# Skill\n\nnew instruction\n",
			content_omitted: false,
		},
	],
	files_omitted: 0,
};

function skillVersionRow(page: Page, path: string) {
	return page
		.locator("[data-skill-version-choice]")
		.filter({ hasText: path });
}

function repositoryVersionRow(page: Page) {
	return page
		.locator("[data-skill-version-choice]")
		.filter({ hasText: "GitHub" });
}

test("different local copies show a file and line diff", async ({ page }) => {
	const mocks = await installMocks(page);
	mocks.addSkill("react-pro", "gemini");
	mocks.addSkillLocation(
		"react-pro",
		"claude",
		"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
	);
	mocks.setSkillDiff(
		"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
		modifiedSkillDiff,
	);
	mocks.setSkillDiffError("/tmp/e2e/.gemini/skills/react-pro/SKILL.md");
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await expect(
		page.getByRole("button", { name: /Compare and unify local copies/ }),
	).toBeVisible();
	await expect(
		page
			.getByRole("status")
			.filter({ hasText: "Some skill copies could not be compared" }),
	).toBeVisible();
	const localRequests = mocks
		.getSkillDiffRequests()
		.filter((request) => request.reference.kind === "installed");
	expect(localRequests).toEqual([
		{
			reference: {
				kind: "installed",
				source_path: "/tmp/e2e/.claude/skills/react-pro/SKILL.md",
			},
			installed_paths: [
				"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
				"/tmp/e2e/.gemini/skills/react-pro/SKILL.md",
				"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
			],
			scope: "global",
			project_root: null,
		},
	]);

	await expect(page.locator('[data-diff-kind="removed"]')).toHaveCount(0);
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	await expect(
		skillVersionRow(page, "/tmp/e2e/.claude/skills/react-pro"),
	).toBeVisible();
	await expect(
		page.getByRole("columnheader", { name: "Source" }),
	).toBeVisible();
	await expect(
		page.getByRole("columnheader", { name: "Location and relationship" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Review file changes" }).click();
	await expect(page.locator('[data-diff-kind="removed"]')).toContainText(
		"old instruction",
	);
	await expect(page.locator('[data-diff-kind="added"]')).toContainText(
		"new instruction",
	);
});

test("a changed file link shows both targets and their status", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setSkillDiff("/tmp/e2e/.cursor/skills/react-pro/SKILL.md", {
		identical: false,
		base_hash: "base",
		target_hash: "target",
		files: [
			{
				path: "references/example.html",
				change: "modified",
				before: null,
				after: null,
				before_link: {
					target: "../../../docs/example.html",
					status: "valid",
				},
				after_link: {
					target: "../../../docs/missing.html",
					status: "broken",
				},
				content_omitted: false,
			},
		],
		files_omitted: 0,
	});
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	await page.getByRole("button", { name: "Review file changes" }).click();

	await expect(
		page.locator('[data-skill-link-status="valid"]'),
	).toContainText("../../../docs/example.html");
	await expect(
		page.locator('[data-skill-link-status="broken"]'),
	).toContainText("../../../docs/missing.html");
	await expect(
		page.locator('[data-skill-link-status="valid"]'),
	).toContainText("Link available");
	await expect(
		page.locator('[data-skill-link-status="broken"]'),
	).toContainText("Target not found");
	await expect(page.locator("[data-diff-kind]")).toHaveCount(0);
	await expect(
		page.getByText("Keep current links", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Convert links to copies", { exact: true }),
	).toBeVisible();
});

test("copy mode materializes every location including its reference", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	const linkedCopyDiff: SkillDirectoryDiffResponse = {
		...modifiedSkillDiff,
		files: [
			...modifiedSkillDiff.files,
			{
				path: "linked-notes.txt",
				change: "modified",
				before: null,
				after: null,
				before_link: { target: "notes.txt", status: "valid" },
				after_link: {
					target: "archive/notes.txt",
					status: "valid",
				},
				content_omitted: false,
			},
		],
	};
	mocks.addSkillLocation(
		"react-pro",
		"claude",
		"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
	);
	mocks.setSkillDiff(
		"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
		linkedCopyDiff,
	);
	mocks.setSkillDiff(
		"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
		linkedCopyDiff,
	);
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	await expect(page.locator("[data-skill-version-choice]")).toHaveCount(2);
	await skillVersionRow(page, "/tmp/e2e/.cursor/skills/react-pro").click();
	await page.getByText("Convert links to copies", { exact: true }).click();
	await page
		.getByRole("button", { name: "Use selected version in 3 locations" })
		.click();

	await expect
		.poll(() => mocks.getSkillCopyResolutionRequests())
		.toEqual([
			{
				reference: {
					kind: "installed",
					source_path: "/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
				},
				expected_reference_hash: "target",
				storage_mode: "copy",
				targets: [
					{
						source_path:
							"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
						expected_hash: "base",
					},
					{
						source_path:
							"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
						expected_hash: "target",
					},
					{
						source_path:
							"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
						expected_hash: "target",
					},
				],
				scope: "global",
				project_root: null,
			},
		]);
	await expect(
		page.getByText("Local skill copies now use the selected version"),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: /Compare and unify local copies/ }),
	).toHaveCount(0);
});

test("a linked local version can be retained and materialized as copies", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	const linkedPath = "/tmp/e2e/.claude/skills/react-pro/SKILL.md";
	mocks.setSkillSymlink("react-pro", "claude");
	mocks.setSkillDiff(
		"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
		modifiedSkillDiff,
	);
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await expect.poll(() => mocks.getSkillDiffRequests()).toHaveLength(1);
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	await expect(
		skillVersionRow(page, "/tmp/e2e/.claude/skills/react-pro"),
	).toBeVisible();
	const linkedVersion = skillVersionRow(
		page,
		"/tmp/e2e/.claude/skills/react-pro",
	);
	await expect(linkedVersion).toContainText("Claude");
	await expect(linkedVersion).toContainText("Symlink");
	await expect(page.locator("[data-skill-diff-file]")).toHaveCount(0);
	await page.getByRole("button", { name: "Review file changes" }).click();
	await expect(page.locator("[data-skill-diff-file]")).toHaveCount(1);
	await linkedVersion.click();
	await expect(page.locator('[data-diff-kind="added"]')).toContainText(
		"old instruction",
	);
	await expect(page.locator('[data-diff-kind="removed"]')).toContainText(
		"new instruction",
	);
	await page.getByText("Convert links to copies", { exact: true }).click();
	await skillVersionRow(page, "/tmp/e2e/.claude/skills/react-pro").click();
	await page
		.getByRole("button", { name: "Use selected version in 2 locations" })
		.click();

	await expect
		.poll(() => mocks.getSkillCopyResolutionRequests())
		.toEqual([
			{
				reference: {
					kind: "installed",
					source_path: linkedPath,
				},
				expected_reference_hash: "base",
				storage_mode: "copy",
				targets: [
					{
						source_path: linkedPath,
						expected_hash: "base",
					},
					{
						source_path:
							"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
						expected_hash: "target",
					},
				],
				scope: "global",
				project_root: null,
			},
		]);
});

test("agent filters do not hide copies from comparison or resolution", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setSkillDiff(
		"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
		modifiedSkillDiff,
	);
	await page.goto("/skills?agent=claude");
	await expect(
		page.getByRole("button", { name: "Change agent filter" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Clear agent filter" }),
	).toBeVisible();
	await expect(
		page
			.getByRole("button", { name: "Change agent filter" })
			.locator("button"),
	).toHaveCount(0);

	await page.getByRole("option", { name: "react-pro" }).click();
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	await skillVersionRow(page, "/tmp/e2e/.cursor/skills/react-pro").click();
	await page
		.getByRole("button", { name: "Use selected version in 2 locations" })
		.click();

	await expect
		.poll(() => mocks.getSkillCopyResolutionRequests())
		.toEqual([
			{
				reference: {
					kind: "installed",
					source_path: "/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
				},
				expected_reference_hash: "target",
				storage_mode: "preserve",
				targets: [
					{
						source_path:
							"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
						expected_hash: "base",
					},
				],
				scope: "global",
				project_root: null,
			},
		]);
});

test("a changed local copy disables stale choices until comparison refreshes", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	const cursorPath = "/tmp/e2e/.cursor/skills/react-pro/SKILL.md";
	mocks.setSkillDiff(cursorPath, modifiedSkillDiff);
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	const cursorChoice = skillVersionRow(
		page,
		"/tmp/e2e/.cursor/skills/react-pro",
	);
	await cursorChoice.click();
	mocks.setSkillDiff(cursorPath, {
		...modifiedSkillDiff,
		target_hash: "changed",
	});
	mocks.setSkillDiffDelay(1_500);
	await page
		.getByRole("button", { name: "Use selected version in 2 locations" })
		.click();

	await expect(
		page.getByText(/A skill copy changed while you were reviewing it/),
	).toBeVisible();
	await expect(cursorChoice).toBeDisabled();
	await expect(cursorChoice).toBeEnabled({ timeout: 5_000 });
	await expect(
		page.getByRole("button", {
			name: "Use selected version in 2 locations",
		}),
	).toBeDisabled();
	await expect(
		page.getByText("Local skill copies now use the selected version"),
	).toHaveCount(0);
});

test("project details unify mixed-scope copies with an explicit root", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	const projectSourcePath = "/tmp/e2e/demo/.claude/skills/react-pro/SKILL.md";
	mocks.addProjectSkill("react-pro", "claude", projectSourcePath, [
		"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
	]);
	mocks.setSkillDiff(projectSourcePath, modifiedSkillDiff);
	await page.goto("/projects/p1?type=skill&resource=react-pro");
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	await skillVersionRow(page, "/tmp/e2e/.claude/skills/react-pro").click();
	await page
		.getByRole("button", { name: "Use selected version in 2 locations" })
		.click();

	await expect
		.poll(() => mocks.getSkillCopyResolutionRequests())
		.toEqual([
			{
				reference: {
					kind: "installed",
					source_path: "/tmp/e2e/.claude/skills/react-pro/SKILL.md",
				},
				expected_reference_hash: "base",
				storage_mode: "preserve",
				targets: [
					{
						source_path: projectSourcePath,
						expected_hash: "target",
					},
				],
				scope: "all",
				project_root: "/tmp/e2e/demo",
			},
		]);
	await expect(
		page.getByText("Local skill copies now use the selected version"),
	).toBeVisible();
});

test("a scanned GitHub skill shows repository differences", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.addSkillLocation(
		"react-pro",
		"claude",
		"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
	);
	mocks.setSkillDiff(
		"/tmp/e2e/.claude/skills/react-pro/SKILL.md|git:skills/react-pro",
		modifiedSkillDiff,
	);
	mocks.setSkillDiffError(
		"/tmp/e2e/.cursor/skills/react-pro/SKILL.md|git:skills/react-pro",
	);
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page.getByRole("button", { name: "Sync from source" }).click();
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await expect(
		page.getByRole("button", {
			name: /Compare repository and local versions/,
		}),
	).toBeVisible();
	await expect(
		page
			.getByRole("status")
			.filter({ hasText: "Repository comparison unavailable" }),
	).toBeVisible();
	const repositoryRequests = mocks
		.getSkillDiffRequests()
		.filter((request) => request.reference.kind === "git_scan");
	expect(repositoryRequests).toEqual([
		{
			reference: {
				kind: "git_scan",
				session_id: "scan-session-1",
				skill_path: "skills/react-pro",
			},
			installed_paths: [
				"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
				"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
				"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
			],
			scope: "global",
			project_root: null,
		},
	]);

	await expect(page.locator('[data-diff-kind="removed"]')).toHaveCount(0);
	await page
		.getByRole("button", {
			name: /Compare repository and local versions/,
		})
		.click();
	await page.getByRole("button", { name: "Review file changes" }).click();
	await expect(page.locator('[data-diff-kind="removed"]')).toContainText(
		"old instruction",
	);
	await expect(page.locator('[data-diff-kind="added"]')).toContainText(
		"new instruction",
	);

	const repositoryVersion = repositoryVersionRow(page);
	await repositoryVersion.click();
	await expect(repositoryVersion).toContainText("GitHub");
	await expect(page.locator('[data-diff-kind="added"]')).toContainText(
		"old instruction",
	);
	await expect(page.locator('[data-diff-kind="removed"]')).toContainText(
		"new instruction",
	);
	await expect(
		page.getByRole("button", { name: "Use repository version" }),
	).toBeDisabled();
	expect(mocks.getSkillCopyResolutionRequests()).toEqual([]);
});

test("the repository version updates every different discovered copy", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.addSkillLocation(
		"react-pro",
		"claude",
		"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
	);
	for (const sourcePath of [
		"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
		"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
	]) {
		mocks.setSkillDiff(
			`${sourcePath}|git:skills/react-pro`,
			modifiedSkillDiff,
		);
	}
	mocks.setSkillDiff(
		"/tmp/e2e/.cursor/skills/react-pro/SKILL.md|git:skills/react-pro",
		{
			identical: true,
			base_hash: "base",
			target_hash: "base",
			files: [],
			files_omitted: 0,
		},
	);
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page.getByRole("button", { name: "Sync from source" }).click();
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await page
		.getByRole("button", {
			name: /Compare repository and local versions/,
		})
		.click();
	await repositoryVersionRow(page).click();
	await page.getByRole("button", { name: "Use repository version" }).click();

	await expect
		.poll(() => mocks.getSkillCopyResolutionRequests())
		.toEqual([
			{
				reference: {
					kind: "git_scan",
					session_id: "scan-session-1",
					skill_path: "skills/react-pro",
				},
				expected_reference_hash: "base",
				storage_mode: "preserve",
				targets: [
					{
						source_path:
							"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
						expected_hash: "base",
					},
					{
						source_path:
							"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
						expected_hash: "target",
					},
					{
						source_path:
							"/tmp/e2e/.z-claude/skills/react-pro/SKILL.md",
						expected_hash: "target",
					},
				],
				scope: "global",
				project_root: null,
			},
		]);
	await expect(
		page.getByRole("status").filter({
			hasText: "Repository content matches",
		}),
	).toBeVisible();
});

test("a changed repository disables stale choices until comparison refreshes", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	const comparisonKey =
		"/tmp/e2e/.claude/skills/react-pro/SKILL.md|git:skills/react-pro";
	mocks.setSkillDiff(comparisonKey, modifiedSkillDiff);
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page.getByRole("button", { name: "Sync from source" }).click();
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await page
		.getByRole("button", {
			name: /Compare repository and local versions/,
		})
		.click();
	const repositoryChoice = repositoryVersionRow(page);
	await repositoryChoice.click();
	mocks.setSkillDiff(comparisonKey, {
		...modifiedSkillDiff,
		base_hash: "repository-changed",
	});
	mocks.setSkillDiffDelay(1_500);
	await page.getByRole("button", { name: "Use repository version" }).click();

	await expect(
		page.getByText(/A skill copy changed while you were reviewing it/),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Choose the version to keep" }),
	).toBeDisabled();
	await page
		.getByRole("button", {
			name: /Compare repository and local versions/,
		})
		.click();
	await expect(repositoryChoice).toBeDisabled();
	await expect(repositoryChoice).toBeEnabled({ timeout: 5_000 });
	await expect(page.getByText("Skill synced successfully")).toHaveCount(0);
});

test("keeping a local version leaves the repository difference visible", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	for (const sourcePath of [
		"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
		"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
	]) {
		mocks.setSkillDiff(
			`${sourcePath}|git:skills/react-pro`,
			modifiedSkillDiff,
		);
	}
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page.getByRole("button", { name: "Sync from source" }).click();
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await page
		.getByRole("button", {
			name: /Local copies match each other, but not the repository/,
		})
		.click();
	await skillVersionRow(page, "/tmp/e2e/.claude/skills/react-pro").click();
	await page
		.getByRole("button", { name: "Keep selected local version" })
		.click();

	await expect(
		page.getByRole("button", {
			name: /Local copies match each other, but not the repository/,
		}),
	).toBeVisible();
	expect(mocks.getSkillCopyResolutionRequests()).toEqual([
		{
			reference: {
				kind: "installed",
				source_path: "/tmp/e2e/.claude/skills/react-pro/SKILL.md",
			},
			expected_reference_hash: "target",
			storage_mode: "preserve",
			targets: [
				{
					source_path: "/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
					expected_hash: "target",
				},
			],
			scope: "global",
			project_root: null,
		},
	]);

	await page.getByRole("button", { name: "Cancel" }).click();
	await page.getByRole("button", { name: "Sync from source" }).click();
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await expect(
		page.getByRole("button", {
			name: /Local copies match each other, but not the repository/,
		}),
	).toBeVisible();
});

test("matching repository and local copies need no resolution", async ({
	page,
}) => {
	await installMocks(page);
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page.getByRole("button", { name: "Sync from source" }).click();
	await page.getByRole("button", { name: "Scan", exact: true }).click();

	await expect(
		page
			.getByRole("status")
			.filter({ hasText: "Repository content matches" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Choose the version to keep" }),
	).toBeDisabled();
});

test("large skill differences stay within the render budget", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	const files = Array.from({ length: 101 }, (_, index) => ({
		path: `${String(index).padStart(3, "0")}.txt`,
		change: "modified" as const,
		before: "old",
		after: index === 0 ? "line\n".repeat(2_500) : "new",
		content_omitted: false,
	}));
	mocks.setSkillDiff("/tmp/e2e/.cursor/skills/react-pro/SKILL.md", {
		identical: false,
		base_hash: "base",
		target_hash: "target",
		files,
		files_omitted: 3,
	});
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	await page.getByRole("button", { name: "Review file changes" }).click();

	await expect(page.locator("[data-skill-diff-file]")).toHaveCount(100);
	await expect(
		page.getByText("Text preview was omitted to keep the diff responsive."),
	).toBeVisible();
	await expect(
		page.getByText("4 additional changed files are not shown."),
	).toBeVisible();
});

test("matching copies use a compact source and relationship summary", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	const agents = [
		["claude", "Claude"],
		["cursor", "Cursor"],
		["gemini", "Gemini"],
		["codex", "Codex"],
		["opencode", "OpenCode"],
		["cline", "Cline"],
		["warp", "Warp"],
		["kimi", "Kimi"],
		["antigravity", "Antigravity"],
	] as const;
	await page.route("http://localhost:45999/api/v1/agents", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(
				agents.map(([id, name]) => agentInfo(id, name)),
			),
		}),
	);
	await page.route(
		"http://localhost:45999/api/v1/agents/availability",
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(
					agents.map(([id]) => ({
						id,
						has_global_directory: true,
						has_cli: true,
						is_available: true,
					})),
				),
			}),
	);
	for (const [agent] of agents.slice(2)) {
		mocks.addSkill("react-pro", agent);
	}
	for (const [agent] of agents.slice(1)) {
		mocks.setSkillDiff(`/tmp/e2e/.${agent}/skills/react-pro/SKILL.md`, {
			...modifiedSkillDiff,
			target_hash: "shared-target",
		});
	}
	await page.setViewportSize({ width: 900, height: 800 });
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();

	const sharedVersion = page
		.locator("[data-skill-version-choice]")
		.filter({ hasText: "Used in 8 locations" });
	await expect(sharedVersion).toBeVisible();
	await expect(sharedVersion).toHaveAccessibleName(/Keep version from/);
	await expect(sharedVersion.getByText("+5", { exact: true })).toBeVisible();
	await expect(sharedVersion).toContainText("8 independent copies");
	const rowBox = await sharedVersion.boundingBox();
	if (!rowBox) throw new Error("shared version row geometry missing");
	expect(rowBox.height).toBeLessThan(96);

	const table = page.getByRole("grid", {
		name: "Choose the version to keep",
	});
	const tableGeometry = await table.evaluate((element) => {
		const scrollContainer = element.parentElement;
		if (!scrollContainer) throw new Error("table scroll container missing");
		return {
			overflow: scrollContainer.scrollWidth - scrollContainer.clientWidth,
			tableWidth: element.getBoundingClientRect().width,
			containerWidth: scrollContainer.getBoundingClientRect().width,
			tableClass: element.className,
			containerClass: scrollContainer.className,
		};
	});
	if (tableGeometry.overflow > 1) {
		throw new Error(
			`skill version table overflowed: ${JSON.stringify(tableGeometry)}`,
		);
	}
});

test("only one location diff is mounted at a time", async ({ page }) => {
	const mocks = await installMocks(page);
	for (let index = 0; index < 31; index += 1) {
		const sourcePath = `/tmp/e2e/.copy-${index}/skills/react-pro/SKILL.md`;
		mocks.addSkillLocation("react-pro", "claude", sourcePath);
		mocks.setSkillDiff(sourcePath, {
			...modifiedSkillDiff,
			target_hash: `target-${index}`,
			files: [
				{
					...modifiedSkillDiff.files[0]!,
					path: `${index}.txt`,
				},
			],
		});
	}
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	await page.getByRole("button", { name: "Review file changes" }).click();

	await expect(page.locator("[data-skill-diff-file]")).toHaveCount(1);
	const comparisonChoices = page.getByRole("radiogroup", {
		name: "Choose a version to compare",
	});
	const comparisonOptions = comparisonChoices.getByRole("radio");
	await expect(comparisonOptions.nth(0)).toHaveAccessibleName(/\/tmp\/e2e/);
	await comparisonOptions.nth(0).press("ArrowRight");
	await comparisonOptions.nth(1).press("Space");
	await expect(comparisonOptions.nth(1)).toBeChecked();
	await skillVersionRow(page, "/tmp/e2e/.copy-0/skills/react-pro").click();
	await expect(
		page.getByRole("button", {
			name: "Use selected version in 33 locations",
		}),
	).toBeEnabled();
	await expect(page.locator("[data-skill-diff-file]")).toHaveCount(1);
	await expect(
		page.locator("[data-skill-diff-file] code").first(),
	).toHaveText("0.txt");
});

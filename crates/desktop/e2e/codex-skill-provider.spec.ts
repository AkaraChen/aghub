import { expect, test } from "@playwright/test";
import type {
	CodexSkillDiscoveryResponse,
	CodexStandaloneSkillResponse,
	SkillDirectoryDiffResponse,
	SkillProviderKindResponse,
	SkillResponse,
} from "../src/generated/dto";
import { installMocks } from "./mocks";

const pluginPath =
	"/tmp/e2e/.codex/plugins/cache/cloudflare/skills/react-pro/SKILL.md";

function codexProvidedSkill(
	name: string,
	kind: SkillProviderKindResponse,
	qualifiedName: string,
	path: string,
	id?: string,
): SkillResponse {
	return {
		name,
		display_name: null,
		enabled: true,
		source_path: path,
		is_symlink: false,
		description: `${qualifiedName} description`,
		author: null,
		version: null,
		tools: [],
		source: "global",
		agent: "codex",
		locations: [
			{
				source_path: path,
				is_symlink: false,
				source: "global",
				provider: {
					kind,
					id,
					qualified_name: qualifiedName,
					managed: true,
				},
			},
		],
	};
}

function discovery(
	skills: SkillResponse[],
	errors: CodexSkillDiscoveryResponse["errors"] = [],
	standaloneSkills: CodexStandaloneSkillResponse[] = [],
): CodexSkillDiscoveryResponse {
	return { skills, standalone_skills: standaloneSkills, errors };
}

const changedPluginCopy: SkillDirectoryDiffResponse = {
	identical: false,
	base_hash: "installed-hash",
	target_hash: "plugin-hash",
	files: [
		{
			path: "SKILL.md",
			change: "modified",
			before: "# Installed\n",
			after: "# Plugin\n",
			content_omitted: false,
		},
	],
	files_omitted: 0,
};

test("Skill names remain primary when display names are present", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setCodexProvidedSkills(
		discovery([
			{
				...codexProvidedSkill(
					"alpha-command",
					"system",
					"alpha-command",
					"/tmp/e2e/.codex/skills/.system/alpha-command/SKILL.md",
				),
				display_name: "Zulu label",
			},
			{
				...codexProvidedSkill(
					"zulu-command",
					"system",
					"zulu-command",
					"/tmp/e2e/.codex/skills/.system/zulu-command/SKILL.md",
				),
				display_name: "Alpha label",
			},
		]),
	);
	await page.goto("/skills");

	const rows = page.getByRole("option", { name: /-command/ });
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toContainText("alpha-command");
	await expect(rows.nth(0)).toContainText("Zulu label");
	await expect(rows.nth(1)).toContainText("zulu-command");
	await expect(rows.nth(1)).toContainText("Alpha label");

	await rows.nth(0).click();
	await expect(
		page.getByRole("heading", { name: "alpha-command", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Zulu label", { exact: true })).toHaveCount(2);
});

test("display names can be hidden from Skill lists and details", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setCodexProvidedSkills(
		discovery([
			{
				...codexProvidedSkill(
					"alpha-command",
					"system",
					"alpha-command",
					"/tmp/e2e/.codex/skills/.system/alpha-command/SKILL.md",
				),
				display_name: "Alpha label",
			},
		]),
	);
	await page.goto("/settings?tab=skills");

	const displayNameSwitch = page.getByRole("switch", {
		name: "Show display names",
	});
	await displayNameSwitch.press("Space");
	await expect(displayNameSwitch).not.toBeChecked();
	await page.reload();
	await expect(
		page.getByRole("switch", { name: "Show display names" }),
	).not.toBeChecked();
	await page.getByRole("link", { name: "Skills", exact: true }).click();

	const row = page.getByRole("option", { name: "alpha-command" });
	await expect(row).toBeVisible();
	await expect(row).not.toContainText("Alpha label");
	await row.click();
	await expect(
		page.getByRole("heading", { name: "alpha-command", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Alpha label", { exact: true })).toHaveCount(0);
});

test("provider-only Skills expose their source without write actions", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setCodexProvidedSkills(
		discovery([
			codexProvidedSkill(
				"openai-docs",
				"system",
				"openai-docs",
				"/tmp/e2e/.codex/skills/.system/openai-docs/SKILL.md",
			),
		]),
	);
	await page.goto("/skills");

	const row = page.getByRole("option", { name: "openai-docs" });
	await row.click();
	await expect(page.getByText("Bundled with Codex")).toBeVisible();
	await expect(page.getByTitle("openai-docs", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Delete Skill" }),
	).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Transfer" })).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Add to Agent" }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Edit in Editor" }),
	).toHaveCount(0);

	await row.click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: "Favorite" }),
	).toBeVisible();
	await expect(
		page.getByRole("menuitem", { name: "Add to Agent" }),
	).toHaveCount(0);
	await expect(page.getByRole("menuitem", { name: "Copy" })).toHaveCount(0);
	await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);

	await page.keyboard.press("Escape");
	await page.getByRole("option", { name: "react-pro" }).click();
	await row.click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: "Add to Agent" }),
	).toHaveCount(0);
	await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
});

test("a plugin copy can be compared but is never a resolution target", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setCodexProvidedSkills(
		discovery([
			codexProvidedSkill(
				"react-pro",
				"plugin",
				"react-pro",
				pluginPath,
				"cloudflare@openai-curated-remote",
			),
		]),
	);
	mocks.setSkillDiff(pluginPath, changedPluginCopy);
	await page.goto("/skills");

	await page.getByRole("option", { name: "react-pro" }).click();
	await page
		.getByRole("button", { name: /Compare and unify local copies/ })
		.click();
	const pluginVersion = page
		.locator("[data-skill-version-choice]")
		.filter({ hasText: "cloudflare@openai-curated-remote" });
	await expect(pluginVersion).toBeVisible();
	await pluginVersion.click();
	await page.getByRole("button", { name: /Use selected version/ }).click();

	await expect
		.poll(() => mocks.getSkillCopyResolutionRequests().length)
		.toBe(1);
	const request = mocks.getSkillCopyResolutionRequests()[0];
	expect(request?.reference).toEqual({
		kind: "installed",
		source_path: pluginPath,
	});
	expect(request?.targets.map((target) => target.source_path).sort()).toEqual(
		[
			"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
			"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
		],
	);
	expect(
		request?.targets.some((target) => target.source_path === pluginPath),
	).toBe(false);
});

test("partial Codex discovery keeps readable Skills without a warning", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setCodexProvidedSkills(
		discovery(
			[
				codexProvidedSkill(
					"openai-docs",
					"system",
					"openai-docs",
					"/tmp/e2e/.codex/skills/.system/openai-docs/SKILL.md",
				),
			],
			[
				{
					cwd: "/tmp/e2e",
					path: "/tmp/e2e/broken/SKILL.md",
					message:
						"invalid description: exceeds maximum length of 1024 characters",
				},
			],
		),
	);
	await page.goto("/skills");

	await expect(
		page.getByRole("option", { name: "openai-docs" }),
	).toBeVisible();
	await expect(page.locator('[data-slot="alert-root"]')).toHaveCount(0);
	await expect(
		page.getByText("invalid description: exceeds maximum length"),
	).toHaveCount(0);
});

test("Agent-provided Skills can be excluded from discovery", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setCodexProvidedSkills(
		discovery([
			codexProvidedSkill(
				"openai-docs",
				"system",
				"openai-docs",
				"/tmp/e2e/.codex/skills/.system/openai-docs/SKILL.md",
			),
		]),
	);
	await page.goto("/settings?tab=skills");

	await page
		.locator('[data-slot="checkbox-content"]')
		.filter({ hasText: "Agent-provided Skills" })
		.click();
	await page.getByRole("link", { name: "Skills", exact: true }).click();
	await expect(page.getByRole("option", { name: "openai-docs" })).toHaveCount(
		0,
	);
});

test("Codex duplicate copies can be resolved when provider discovery is off", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.setCodexProvidedSkills(
		discovery(
			[],
			[],
			[
				{
					name: "react-pro",
					source_path: "/tmp/e2e/.claude/skills/react-pro/SKILL.md",
					enabled: true,
				},
				{
					name: "react-pro",
					source_path: "/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
					enabled: true,
				},
			],
		),
	);
	await page.goto("/settings?tab=skills");
	await page
		.locator('[data-slot="checkbox-content"]')
		.filter({ hasText: "Agent-provided Skills" })
		.click();
	await page.getByRole("link", { name: "Skills", exact: true }).click();

	await page.getByRole("option", { name: "react-pro" }).click();
	await expect(
		page.getByRole("button", { name: /Copies shown in Codex/ }),
	).toContainText("Codex currently shows 2 of 2 copies");
	await page
		.locator('[data-slot="radio"]')
		.filter({
			hasText: "/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
		})
		.click();
	await page
		.getByRole("button", { name: "Show only this copy in Codex" })
		.click();

	await expect
		.poll(() => mocks.getCodexVisibleCopyRequests())
		.toEqual([
			{
				name: "react-pro",
				source_path: "/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
			},
		]);
	await expect(
		page.getByRole("button", { name: /Copies shown in Codex/ }),
	).toContainText("Codex currently shows 1 of 2 copies");
});

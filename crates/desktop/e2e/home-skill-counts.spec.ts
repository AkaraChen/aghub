import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test("home counts universal and native skills visible to an agent", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	mocks.addAgent("codex", "OpenAI Codex", true);
	mocks.addSkill(
		"shared-skill",
		"universal",
		"/tmp/e2e/.agents/skills/shared-skill/SKILL.md",
	);
	mocks.addSkill("codex-skill", "codex");

	await page.goto("/");

	const card = page
		.getByRole("region", { name: "Your agents" })
		.getByText("OpenAI Codex", { exact: true })
		.locator('xpath=ancestor::*[@data-slot="card"]');
	await expect(card.getByRole("button", { name: "Skills 2" })).toBeVisible();

	const claudeCard = page
		.getByRole("region", { name: "Your agents" })
		.getByText("Claude", { exact: true })
		.locator('xpath=ancestor::*[@data-slot="card"]');
	await expect(
		claudeCard.getByRole("button", { name: "Skills 5" }),
	).toBeVisible();
});

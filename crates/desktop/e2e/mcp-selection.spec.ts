import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	await page.goto("/mcp");
	await expect(page.getByRole("option", { name: "alpha-mcp" })).toBeVisible();
});

test("the first server is selected and shown on load", async ({ page }) => {
	// Selection is the single source of truth, seeded with the first server
	await expect(
		page.getByRole("option", { name: "alpha-mcp", selected: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "alpha-mcp" }),
	).toBeVisible();
});

test("clicking the selected server again cancels to the placeholder", async ({
	page,
}) => {
	// beta-mcp is not the seeded first server, so the first click selects it
	await page.getByRole("option", { name: "beta-mcp" }).click();
	await expect(
		page.getByRole("heading", { name: "beta-mcp" }),
	).toBeVisible();

	// Clicking it again cancels the selection -> empty placeholder
	await page.getByRole("option", { name: "beta-mcp" }).click();
	await expect(
		page.getByText("Select a server to view details"),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "beta-mcp" }),
	).toBeHidden();
});

test("multi-select opens the bulk panel and exiting collapses to one", async ({
	page,
}) => {
	await page.getByRole("option", { name: "beta-mcp" }).click();
	await page
		.getByRole("option", { name: "alpha-mcp" })
		.click({ modifiers: ["ControlOrMeta"] });
	await expect(page.getByText("2 items selected")).toBeVisible();

	// Selecting a second server auto-enters multi-select, so the toggle now
	// reads "Cancel"; clicking it collapses to a single selection
	await page
		.getByRole("button", { name: "Cancel", exact: true })
		.first()
		.click();
	await expect(page.getByText("2 items selected")).toBeHidden();
	await expect(
		page.getByRole("heading", { name: /alpha-mcp|beta-mcp/ }),
	).toBeVisible();
});

test("editing a server's transport keeps it selected after the mergeKey changes", async ({
	page,
}) => {
	// alpha-mcp is seeded/selected on load; open its editor
	await expect(
		page.getByRole("heading", { name: "alpha-mcp" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Edit server" }).click();

	// Changing the command changes the transport hash and thus the mergeKey
	const command = page.getByRole("textbox", { name: "Command" });
	await command.fill("/usr/bin/alpha-mcp-v2");
	await page.getByRole("button", { name: "Save" }).click();

	// The detail must follow the edited server (new mergeKey), not strand on
	// the empty placeholder
	await expect(
		page.getByRole("heading", { name: "alpha-mcp" }),
	).toBeVisible();
	await expect(
		page.getByText("Select a server to view details"),
	).toBeHidden();
});

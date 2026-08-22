import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

const PROMPT = {
	id: "prompt-1",
	title: "Review changes",
	description: "Check a patch before merging it.",
	category: "Workflow",
	content: "Review {{target}} and report concrete findings.",
	tags: ["review"],
	variables: ["target"],
	created_at: 1,
	updated_at: 2,
};

const OLDER_PROMPT = {
	...PROMPT,
	id: "prompt-older",
	title: "Draft release notes",
	created_at: 0,
	updated_at: 1,
};

const GLOBAL_SEARCH_LABEL =
	"Search agents, skills, MCP servers, sub-agents, prompts, and library";

test("selects a valid deep link or falls back to the newest prompt", async ({
	page,
}) => {
	await installMocks(page);
	await page.route(
		"http://localhost:45999/api/v1/prompts**",
		async (route) => {
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([OLDER_PROMPT, PROMPT]),
			});
		},
	);

	await page.goto("/prompts");
	await expect(
		page.getByRole("heading", { name: PROMPT.title }),
	).toBeVisible();

	await page.goto("/prompts?prompt=missing");
	await expect(
		page.getByRole("heading", { name: PROMPT.title }),
	).toBeVisible();

	await page.goto(`/prompts?prompt=${OLDER_PROMPT.id}`);
	await expect(
		page.getByRole("heading", { name: OLDER_PROMPT.title }),
	).toBeVisible();
});

test("keeps prompt list metadata inline and preserves hover feedback", async ({
	page,
}) => {
	await installMocks(page);
	await page.route(
		"http://localhost:45999/api/v1/prompts**",
		async (route) => {
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([OLDER_PROMPT, PROMPT]),
			});
		},
	);

	await page.goto(`/prompts?prompt=${PROMPT.id}`);
	const selectedPrompt = page.getByRole("option", {
		name: new RegExp(PROMPT.title),
	});
	const title = selectedPrompt.getByText(PROMPT.title, { exact: true });
	const category = selectedPrompt.getByText(PROMPT.category, { exact: true });
	const [titleBox, categoryBox] = await Promise.all([
		title.boundingBox(),
		category.boundingBox(),
	]);

	expect(titleBox).not.toBeNull();
	expect(categoryBox).not.toBeNull();
	expect(Math.abs(titleBox!.y - categoryBox!.y)).toBeLessThanOrEqual(6);

	const backgroundBeforeHover = await selectedPrompt.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);
	await selectedPrompt.hover();
	await expect
		.poll(() =>
			selectedPrompt.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		)
		.not.toBe(backgroundBeforeHover);
});

test("keeps delete confirmation open while deletion is pending and after failure", async ({
	page,
}) => {
	await installMocks(page);

	let markDeleteStarted: () => void;
	const deleteStarted = new Promise<void>((resolve) => {
		markDeleteStarted = resolve;
	});
	let finishDelete: () => void;
	const deleteFinished = new Promise<void>((resolve) => {
		finishDelete = resolve;
	});

	await page.route(
		"http://localhost:45999/api/v1/prompts**",
		async (route) => {
			if (route.request().method() === "DELETE") {
				markDeleteStarted();
				await deleteFinished;
				return route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "Delete failed" }),
				});
			}

			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([PROMPT]),
			});
		},
	);

	await page.goto(`/prompts?prompt=${PROMPT.id}`);
	await expect(
		page.getByRole("heading", { name: PROMPT.title }),
	).toBeVisible();

	await page.getByRole("button", { name: "Delete prompt" }).click();
	const dialog = page.getByRole("alertdialog", { name: "Delete prompt" });
	const confirmation = dialog.getByText(
		`Delete "${PROMPT.title}"? This can't be undone.`,
	);
	await expect(confirmation).toBeVisible();

	const deleteButton = dialog.getByRole("button", {
		name: "Delete prompt",
	});
	await deleteButton.click();
	await deleteStarted;
	await expect(dialog).toBeVisible();
	await expect(deleteButton).toBeDisabled();

	const deleteResponse = page.waitForResponse(
		(response) =>
			response.request().method() === "DELETE" &&
			response.url().endsWith(`/prompts/${PROMPT.id}`),
	);
	finishDelete();
	await deleteResponse;
	await expect(page.getByText("Delete failed")).toBeVisible();
	await expect(dialog).toBeVisible();
	await expect(deleteButton).toBeEnabled();
});

test("closes delete confirmation before showing the next prompt", async ({
	page,
}) => {
	await installMocks(page);
	const prompts = [PROMPT, OLDER_PROMPT];

	await page.route(
		"http://localhost:45999/api/v1/prompts**",
		async (route) => {
			const request = route.request();
			if (request.method() === "DELETE") {
				const id = new URL(request.url()).pathname.split("/").pop();
				const index = prompts.findIndex((prompt) => prompt.id === id);
				if (index !== -1) prompts.splice(index, 1);
				return route.fulfill({ status: 204 });
			}

			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(prompts),
			});
		},
	);

	await page.goto(`/prompts?prompt=${PROMPT.id}`);
	await page.getByRole("button", { name: "Delete prompt" }).click();
	const dialog = page.getByRole("alertdialog", { name: "Delete prompt" });
	await dialog.getByRole("button", { name: "Delete prompt" }).click();

	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("heading", { name: OLDER_PROMPT.title }),
	).toBeVisible();
});

test("creates, searches, edits, and deletes a prompt", async ({ page }) => {
	await installMocks(page);
	const prompts: (typeof PROMPT)[] = [];

	await page.route(
		"http://localhost:45999/api/v1/prompts**",
		async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			const id = url.pathname.split("/").pop();
			const json = (body: unknown) =>
				route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(body),
				});

			if (request.method() === "POST") {
				const body = request.postDataJSON();
				const prompt = {
					id: "created-prompt",
					title: body.title,
					description: body.description,
					category: body.category,
					content: body.content,
					tags: body.tags,
					variables: ["target"],
					created_at: 3,
					updated_at: 3,
				};
				prompts.push(prompt);
				return json(prompt);
			}

			if (request.method() === "PUT") {
				const body = request.postDataJSON();
				const prompt = prompts.find((item) => item.id === id);
				if (!prompt) return route.fulfill({ status: 404 });
				Object.assign(prompt, body, { updated_at: 4 });
				return json(prompt);
			}

			if (request.method() === "DELETE") {
				const index = prompts.findIndex((item) => item.id === id);
				if (index !== -1) prompts.splice(index, 1);
				return route.fulfill({ status: 204 });
			}

			return json(prompts);
		},
	);

	await page.goto("/prompts");
	await expect(page.getByText("No prompts yet")).toBeVisible();
	await page.getByRole("button", { name: "Create prompt" }).first().click();

	await page.getByRole("textbox", { name: "Title" }).fill(PROMPT.title);
	await page
		.getByRole("textbox", { name: "Description" })
		.fill(PROMPT.description);
	await page.getByRole("textbox", { name: "Category" }).fill(PROMPT.category);
	await page.getByRole("textbox", { name: "Content" }).fill(PROMPT.content);
	const tags = page.getByRole("textbox", { name: "Tags" });
	await tags.fill("review");
	await tags.press("Enter");
	await expect(
		page.getByRole("button", { name: "Remove tag review" }),
	).toBeVisible();
	await tags.fill("merge");
	await tags.press("Enter");
	await page.getByRole("button", { name: "Remove tag review" }).click();
	await expect(
		page.getByRole("button", { name: "Remove tag review" }),
	).toBeHidden();
	await tags.fill("review");
	await tags.press("Enter");
	await expect(tags).toHaveValue("");
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: PROMPT.title }),
	).toBeVisible();
	await expect(
		page
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: "Category" }) })
			.getByText(PROMPT.category, { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Filter prompts by category" })
		.click();
	await page.getByRole("option", { name: "Uncategorized" }).click();
	await expect(page.getByText("No prompts match your search")).toBeVisible();
	await page
		.getByRole("button", { name: "Filter prompts by category" })
		.click();
	await page.getByRole("option", { name: PROMPT.category }).click();
	await expect(
		page.getByRole("option", { name: new RegExp(PROMPT.title) }),
	).toBeVisible();

	const search = page.getByRole("searchbox", { name: "Search prompts..." });
	await search.fill("patch before merging");
	await expect(
		page.getByRole("option", { name: new RegExp(PROMPT.title) }),
	).toBeVisible();
	await search.fill("report concrete findings");
	await expect(
		page.getByRole("option", { name: new RegExp(PROMPT.title) }),
	).toBeVisible();
	await search.fill("no matching prompt");
	await expect(page.getByText("No prompts match your search")).toBeVisible();
	await expect(
		page.getByText("Create your first prompt to get started."),
	).toBeHidden();

	await page.goto("/mcp");
	const globalSearch = page.getByRole("combobox", {
		name: GLOBAL_SEARCH_LABEL,
	});
	await globalSearch.fill("report concrete findings");
	const globalResults = page.getByRole("listbox", {
		name: GLOBAL_SEARCH_LABEL,
	});
	await globalResults
		.getByRole("option", { name: new RegExp(PROMPT.title) })
		.click();
	await expect(page).toHaveURL(/\/prompts\?prompt=created-prompt/);

	await page.getByRole("button", { name: "Edit prompt" }).click();
	await page
		.getByRole("textbox", { name: "Title" })
		.fill("Review release changes");
	await page.getByRole("button", { name: "Save" }).click();
	await expect(
		page.getByRole("heading", { name: "Review release changes" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Delete prompt" }).click();
	const dialog = page.getByRole("alertdialog", { name: "Delete prompt" });
	await dialog.getByRole("button", { name: "Delete prompt" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText("No prompts yet")).toBeVisible();
});

test("exports and merges a versioned prompt backup from settings", async ({
	page,
}) => {
	await installMocks(page);
	const backup = {
		format: "aghub-prompts",
		version: 1,
		exported_at: 10,
		prompts: [
			{
				id: PROMPT.id,
				title: PROMPT.title,
				description: PROMPT.description,
				category: PROMPT.category,
				content: PROMPT.content,
				tags: PROMPT.tags,
				created_at: PROMPT.created_at,
				updated_at: PROMPT.updated_at,
			},
		],
	};
	let importBody: unknown;

	await page.route(
		"http://localhost:45999/api/v1/prompts**",
		async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			if (url.pathname.endsWith("/backup/import")) {
				importBody = request.postDataJSON();
				return route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						added: 0,
						updated: 1,
						unchanged: 0,
						removed: 0,
						total: 1,
					}),
				});
			}
			if (url.pathname.endsWith("/backup")) {
				return route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(backup),
				});
			}
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([PROMPT]),
			});
		},
	);

	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto("/settings?tab=prompts");
	await expect(page.getByRole("tab", { name: "Prompts" })).toHaveCSS(
		"white-space",
		"nowrap",
	);
	await expect(page.getByRole("tab", { name: "Appearance" })).toBeVisible();
	await expect(page.getByRole("tab", { name: "About" })).toBeVisible();
	await expect(
		page.getByText("1 prompts are stored on this device."),
	).toBeVisible();

	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "Export backup" }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^aghub-prompts-.*\.json$/);

	const chooserPromise = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Import backup" }).click();
	const chooser = await chooserPromise;
	await chooser.setFiles({
		name: "prompt-backup.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(backup)),
	});

	const dialog = page.getByRole("dialog", { name: "Import backup" });
	await expect(
		dialog.getByText("This backup contains 1 prompts."),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Import backup" }).click();
	await expect(
		page.getByText(
			"Import complete: 0 added, 1 updated, 0 removed, 1 in total.",
		),
	).toBeVisible();
	await expect(dialog).toBeHidden();
	expect(importBody).toEqual({ backup, mode: "merge" });

	const replaceChooserPromise = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Import backup" }).click();
	const replaceChooser = await replaceChooserPromise;
	await replaceChooser.setFiles({
		name: "prompt-backup.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(backup)),
	});
	const replaceDialog = page.getByRole("dialog", { name: "Import backup" });
	await replaceDialog
		.getByText("Replace local library", { exact: true })
		.click();
	await replaceDialog.getByRole("button", { name: "Import backup" }).click();
	await expect(replaceDialog).toBeHidden();
	expect(importBody).toEqual({ backup, mode: "replace" });
});

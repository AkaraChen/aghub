import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

const PROMPT = {
	id: "prompt-1",
	title: "Review changes",
	description: "Check a patch before merging it.",
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
	await page.getByRole("textbox", { name: "Content" }).fill(PROMPT.content);
	await page.getByRole("textbox", { name: "Tags" }).fill("review, merge");
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: PROMPT.title }),
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
		name: /Search agents/,
	});
	await globalSearch.fill("report concrete findings");
	const globalResults = page.getByRole("listbox", {
		name: /Search agents/,
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

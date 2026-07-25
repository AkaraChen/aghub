import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test("fetches models from the current provider form without a preset", async ({
	page,
}) => {
	await installMocks(page);
	let modelsRequest: unknown;
	await page.route(
		"http://localhost:45999/api/v1/inference/**",
		async (route) => {
			const request = route.request();
			const path = new URL(request.url()).pathname.replace("/api/v1", "");
			if (
				request.method() === "GET" &&
				(path === "/inference/providers" ||
					path === "/inference/presets")
			) {
				await route.fulfill({ json: [] });
				return;
			}
			if (
				request.method() === "POST" &&
				path === "/inference/providers/models"
			) {
				modelsRequest = request.postDataJSON();
				await route.fulfill({
					json: ["model-alpha", "model-beta"],
				});
				return;
			}
			await route.fallback();
		},
	);

	await page.goto("/inference-providers");
	await page.getByRole("button", { name: "Add Provider" }).first().click();

	const fetchModels = page.locator("button").filter({
		hasText: /^Fetch models$/,
	});
	await expect(fetchModels).toBeDisabled();

	const apiBaseUrl = page.getByRole("textbox", { name: "API Base URL" });
	await apiBaseUrl.fill("api.example.com/v1/chat/completions");
	await expect(fetchModels).toBeDisabled();

	await page.getByRole("textbox", { name: "API Key" }).fill("test-key");
	await expect(apiBaseUrl).toHaveValue("https://api.example.com/v1");
	await expect(fetchModels).toBeEnabled();
	await fetchModels.click();

	await expect
		.poll(() => modelsRequest)
		.toEqual({
			format: "openai_responses",
			api_base_url: "https://api.example.com/v1",
			api_key: "test-key",
			provider_id: null,
		});
	const modelNames = page.getByRole("textbox", { name: "Model name" });
	await expect(modelNames).toHaveCount(2);
	await expect(modelNames.first()).toHaveValue("model-alpha");
	await expect(modelNames.nth(1)).toHaveValue("model-beta");
	await expect(
		page.getByText("Added 2 new model(s) (2 returned)"),
	).toBeVisible();
});

test("requires the API key again after the provider URL changes", async ({
	page,
}) => {
	await installMocks(page);
	await page.route(
		"http://localhost:45999/api/v1/inference/**",
		async (route) => {
			const request = route.request();
			const path = new URL(request.url()).pathname.replace("/api/v1", "");
			if (request.method() === "GET" && path === "/inference/providers") {
				await route.fulfill({
					json: [
						{
							id: "provider-id",
							latin_name: "example",
							display_name: "Example",
							format: "openai_responses",
							api_base_url: "https://api.example.com/v1",
							preset: null,
							masked_api_key: "sk-••••",
							models: ["model-alpha"],
						},
					],
				});
				return;
			}
			if (request.method() === "GET" && path === "/inference/presets") {
				await route.fulfill({ json: [] });
				return;
			}
			await route.fallback();
		},
	);

	await page.goto("/inference-providers");
	await page.locator('button[aria-label="Edit Provider"]').click();

	const fetchModels = page.locator("button").filter({
		hasText: /^Fetch models$/,
	});
	await expect(fetchModels).toBeEnabled();

	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://other.example.com/v1");
	await expect(fetchModels).toBeDisabled();
	await expect(
		page.getByText(
			"The API URL or format changed. Enter the API key again before fetching models.",
		),
	).toBeVisible();

	await page
		.getByRole("textbox", { name: "API Key" })
		.fill("replacement-key");
	await expect(fetchModels).toBeEnabled();
});

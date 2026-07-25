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

	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://api.example.com/v1");
	await expect(fetchModels).toBeDisabled();

	await page.getByLabel("API Key").fill("test-key");
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

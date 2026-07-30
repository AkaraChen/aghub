import {
	expect,
	test,
	type Page,
	type Response,
	type Route,
} from "@playwright/test";
import { installMocks } from "./mocks";

const INFERENCE_ROUTE = "http://localhost:45999/api/v1/inference/**";

async function installProviderDiscoveryMocks(
	page: Page,
	{
		providers = [],
		onFetchModels,
	}: {
		providers?: unknown[];
		onFetchModels: (route: Route) => Promise<void>;
	},
) {
	await installMocks(page);
	await page.route(INFERENCE_ROUTE, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.replace("/api/v1", "");
		if (request.method() === "GET" && path === "/inference/providers") {
			await route.fulfill({ json: providers });
			return;
		}
		if (request.method() === "GET" && path === "/inference/presets") {
			await route.fulfill({ json: [] });
			return;
		}
		if (
			request.method() === "POST" &&
			path === "/inference/providers/models"
		) {
			await onFetchModels(route);
			return;
		}
		await route.fallback();
	});
}

function waitForModelListResponse(page: Page) {
	return page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname.endsWith(
				"/inference/providers/models",
			),
	);
}

async function waitForRendererAfterResponse(
	page: Page,
	response: Promise<Response>,
) {
	await response;
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => resolve());
				});
			}),
	);
}

async function openCreateProviderForm(
	page: Page,
	apiBaseUrl: string,
	apiKey: string,
) {
	await page.goto("/inference-providers");
	await page.getByRole("button", { name: "Add Provider" }).first().click();
	await page.getByRole("textbox", { name: "API Base URL" }).fill(apiBaseUrl);
	await page.getByRole("textbox", { name: "API Key" }).fill(apiKey);
}

test("fetches models from the current provider form without a preset", async ({
	page,
}) => {
	let modelsRequest: unknown;
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			const request = route.request();
			modelsRequest = request.postDataJSON();
			await route.fulfill({
				json: ["model-alpha", "model-beta"],
			});
		},
	});

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

test("does not save a create-form key under a different URL", async ({
	page,
}) => {
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await route.fulfill({ json: [] });
		},
	});

	await openCreateProviderForm(
		page,
		"https://first.example.com/v1",
		"first-scope-key",
	);
	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://second.example.com/v1");
	await page.getByRole("button", { name: "Create" }).click();

	await expect(
		page.getByText(
			"The API URL or format changed. Enter the API key again before saving.",
		),
	).toBeVisible();
});

test("requires the API key again after the provider URL changes", async ({
	page,
}) => {
	let modelsRequest: unknown;
	await installProviderDiscoveryMocks(page, {
		providers: [
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
		onFetchModels: async (route) => {
			const request = route.request();
			modelsRequest = request.postDataJSON();
			await route.fulfill({ json: ["model-alpha"] });
		},
	});

	await page.goto("/inference-providers");
	await page.locator('button[aria-label="Edit Provider"]').click();

	const fetchModels = page.locator("button").filter({
		hasText: /^Fetch models$/,
	});
	await expect(fetchModels).toBeEnabled();
	await fetchModels.click();
	await expect
		.poll(() => modelsRequest)
		.toEqual({
			format: "openai_responses",
			api_base_url: "https://api.example.com/v1",
			api_key: null,
			provider_id: "provider-id",
		});

	await page.getByRole("textbox", { name: "API Key" }).fill("old-scope-key");
	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://other.example.com/v1");
	await expect(fetchModels).toBeDisabled();
	await expect(
		page.getByText(
			"The API URL or format changed. Enter the API key again before fetching models.",
		),
	).toBeVisible();
	const disabledReasonId = await fetchModels.getAttribute("aria-describedby");
	expect(disabledReasonId).toBeTruthy();
	await expect(page.locator(`[id="${disabledReasonId}"]`)).toContainText(
		"The API URL or format changed.",
	);

	await page.getByRole("button", { name: "Save" }).click();
	await expect(
		page.getByText(
			"The API URL or format changed. Enter the API key again before saving.",
		),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Update agent configs?" }),
	).toHaveCount(0);

	const apiKey = page.getByRole("textbox", { name: "API Key" });
	await expect(apiKey).toHaveAttribute("aria-required", "true");
	await expect(apiKey).toHaveAttribute("placeholder", "sk-...");

	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://api.example.com/v1");
	await expect(
		page.getByText(
			"The API URL or format changed. Enter the API key again before saving.",
		),
	).toHaveCount(0);
	await expect(apiKey).not.toHaveAttribute("aria-required", "true");
	await expect(apiKey).toHaveAttribute(
		"placeholder",
		"Leave empty to keep current key",
	);
	await expect(fetchModels).toBeEnabled();

	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://other.example.com/v1");
	await expect(apiKey).toHaveAttribute("aria-required", "true");
	await apiKey.fill("replacement-key");
	await expect(fetchModels).toBeEnabled();
});

test("ignores a delayed response after the request scope changes", async ({
	page,
}) => {
	let releaseResponse: (() => void) | undefined;
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await responseGate;
			await route.fulfill({ json: ["stale-model"] });
		},
	});

	await openCreateProviderForm(
		page,
		"https://first.example.com/v1",
		"test-key",
	);

	const fetchModels = page.locator("button").filter({
		hasText: /^Fetch models$/,
	});
	const staleResponse = waitForModelListResponse(page);
	await fetchModels.click();
	await expect(
		page.locator("button").filter({ hasText: /^Fetching models…$/ }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Create" })).toBeDisabled();

	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://second.example.com/v1");
	await expect(fetchModels).toBeDisabled();
	await page
		.getByRole("textbox", { name: "API Key" })
		.fill("replacement-key");
	await expect(fetchModels).toBeEnabled();

	releaseResponse?.();
	await waitForRendererAfterResponse(page, staleResponse);
	const modelName = page.getByRole("textbox", { name: "Model name" });
	await expect(modelName).toHaveValue("");
	await expect(page.getByText(/stale-model/)).toHaveCount(0);
});

test("requires a new key when a legacy provider URL is replaced", async ({
	page,
}) => {
	await installProviderDiscoveryMocks(page, {
		providers: [
			{
				id: "provider-id",
				latin_name: "example",
				display_name: "Example",
				format: "openai_responses",
				api_base_url: "not a valid URL",
				preset: null,
				masked_api_key: "sk-••••",
				models: ["model-alpha"],
			},
		],
		onFetchModels: async (route) => {
			await route.fulfill({ json: ["model-alpha"] });
		},
	});

	await page.goto("/inference-providers");
	await page.locator('button[aria-label="Edit Provider"]').click();
	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://api.example.com/v1");
	await page.getByRole("button", { name: "Save" }).click();

	await expect(
		page.getByText(
			"The API URL or format changed. Enter the API key again before saving.",
		),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Update agent configs?" }),
	).toHaveCount(0);
});

test("ignores a delayed response after the provider form unmounts", async ({
	page,
}) => {
	let releaseResponse: (() => void) | undefined;
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await responseGate;
			await route.fulfill({ json: ["stale-model"] });
		},
	});

	await openCreateProviderForm(
		page,
		"https://api.example.com/v1",
		"test-key",
	);

	const modelResponse = waitForModelListResponse(page);
	await page
		.locator("button")
		.filter({ hasText: /^Fetch models$/ })
		.click();
	await expect(
		page.locator("button").filter({ hasText: /^Fetching models…$/ }),
	).toBeVisible();

	await page.getByRole("option", { name: "Claude", exact: true }).click();
	await expect(
		page.getByRole("textbox", { name: "API Base URL" }),
	).toHaveCount(0);

	releaseResponse?.();
	await waitForRendererAfterResponse(page, modelResponse);
	await expect(page.getByText(/Added 1 new model/)).toHaveCount(0);
	await expect(page.getByText(/stale-model/)).toHaveCount(0);
});

test("keeps a manual model edit made while discovery is pending", async ({
	page,
}) => {
	let releaseResponse: (() => void) | undefined;
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await responseGate;
			await route.fulfill({
				json: ["MANUAL-MODEL", "fetched-model"],
			});
		},
	});

	await openCreateProviderForm(
		page,
		"https://api.example.com/v1",
		"test-key",
	);

	const fetchModels = page.locator("button").filter({
		hasText: /^Fetch models$/,
	});
	const modelResponse = waitForModelListResponse(page);
	await fetchModels.click();
	const modelName = page.getByRole("textbox", { name: "Model name" });
	await modelName.fill("manual-model");
	await expect(
		page.locator("button").filter({ hasText: /^Fetching models…$/ }),
	).toBeVisible();

	releaseResponse?.();
	await waitForRendererAfterResponse(page, modelResponse);
	await expect(modelName).toHaveCount(2);
	await expect(modelName.first()).toHaveValue("manual-model");
	await expect(modelName.nth(1)).toHaveValue("fetched-model");
});

test("keeps a model row cleared while discovery is pending", async ({
	page,
}) => {
	let releaseResponse: (() => void) | undefined;
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	await installProviderDiscoveryMocks(page, {
		providers: [
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
		onFetchModels: async (route) => {
			await responseGate;
			await route.fulfill({
				json: ["model-alpha", "fetched-model"],
			});
		},
	});

	await page.goto("/inference-providers");
	await page.locator('button[aria-label="Edit Provider"]').click();

	const modelName = page.getByRole("textbox", { name: "Model name" });
	const modelResponse = waitForModelListResponse(page);
	await page
		.locator("button")
		.filter({ hasText: /^Fetch models$/ })
		.click();
	await modelName.fill("");

	releaseResponse?.();
	await waitForRendererAfterResponse(page, modelResponse);
	await expect(modelName).toHaveCount(2);
	await expect(modelName.first()).toHaveValue("");
	await expect(modelName.nth(1)).toHaveValue("fetched-model");
});

test("announces a discovery error and clears it after the scope changes", async ({
	page,
}) => {
	let releaseResponse: (() => void) | undefined;
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await responseGate;
			await route.fulfill({
				status: 504,
				json: {
					code: "UPSTREAM_TIMEOUT",
					error: "provider model request timed out",
				},
			});
		},
	});

	await openCreateProviderForm(
		page,
		"https://first.example.com/v1",
		"test-key",
	);

	const fetchModels = page.locator("button").filter({
		hasText: /^Fetch models$/,
	});
	const staleResponse = waitForModelListResponse(page);
	await fetchModels.click();
	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://second.example.com/v1");
	releaseResponse?.();
	await waitForRendererAfterResponse(page, staleResponse);
	await expect(page.getByRole("alert")).toHaveCount(0);

	await page
		.getByRole("textbox", { name: "API Key" })
		.fill("replacement-key");
	await fetchModels.click();
	const alert = page.getByRole("alert");
	await expect(alert).toContainText(
		"Failed to fetch models: The provider model request timed out.",
	);
	const errorId = await fetchModels.getAttribute("aria-describedby");
	expect(errorId).toBeTruthy();
	await expect(page.locator(`[id="${errorId}"]`)).toHaveAttribute(
		"role",
		"alert",
	);
});

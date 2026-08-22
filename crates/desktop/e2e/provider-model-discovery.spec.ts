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
		presets = [],
		onFetchModels,
	}: {
		providers?: unknown[];
		presets?: unknown[];
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
			await route.fulfill({ json: presets });
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

test("shows provider field help on hover and keyboard focus", async ({
	page,
}) => {
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await route.fulfill({ json: [] });
		},
	});

	await page.goto("/inference-providers");
	await page.getByRole("button", { name: "Add Provider" }).first().click();

	const helpText =
		"Written to agent config files as the provider key. Use lowercase a-z only.";
	const helpTrigger = page.locator(
		`[data-slot="tooltip-trigger"][aria-label="${helpText}"]`,
	);
	await expect(helpTrigger).toHaveCount(1);
	await expect(helpTrigger.locator('[tabindex="0"]')).toHaveCount(0);

	await helpTrigger.hover();
	await expect(page.getByRole("tooltip")).toContainText(helpText);
	await page.mouse.move(0, 0);
	await expect(page.getByRole("tooltip")).toHaveCount(0);

	await helpTrigger.focus();
	await expect(page.getByRole("tooltip")).toContainText(helpText);
	await page.getByRole("textbox", { name: "Provider ID" }).focus();
	await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("keeps the Provider ID suggested until the user supplies one", async ({
	page,
}) => {
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await route.fulfill({ json: [] });
		},
	});

	await page.goto("/inference-providers");
	await page.getByRole("button", { name: "Add Provider" }).first().click();

	const displayName = page.getByRole("textbox", { name: "Display Name" });
	const providerId = page.getByRole("textbox", { name: "Provider ID" });

	await expect(displayName).toHaveAttribute("spellcheck", "false");
	await expect(displayName).toHaveAttribute("autocorrect", "off");
	await expect(displayName).toHaveAttribute("autocapitalize", "none");

	await displayName.fill("OpenAI");
	await expect(providerId).toHaveValue("openai");

	await providerId.fill("custom");
	await displayName.fill("Other name");
	await expect(providerId).toHaveValue("custom");

	await providerId.fill("");
	await displayName.fill("yunwu.ai");
	await expect(providerId).toHaveValue("yunwuai");
});

test("uses a preset ID while the Provider ID remains automatic", async ({
	page,
}) => {
	await installProviderDiscoveryMocks(page, {
		presets: [
			{
				id: "xiaomi-token-plan-cn",
				name: "Xiaomi Token Plan (China)",
				api_base_url: "https://token-plan-cn.xiaomimimo.com/v1",
				format: "openai_responses",
				models: ["mimo-v2.5"],
				logo: "",
			},
		],
		onFetchModels: async (route) => {
			await route.fulfill({ json: [] });
		},
	});

	await page.goto("/inference-providers");
	await page.getByRole("button", { name: "Add Provider" }).first().click();
	await page.getByRole("button", { name: "Quick start" }).click();
	await page
		.getByRole("option", { name: "Xiaomi Token Plan (China)" })
		.click();

	await expect(
		page.getByRole("textbox", { name: "Display Name" }),
	).toHaveValue("Xiaomi Token Plan (China)");
	await expect(
		page.getByRole("textbox", { name: "Provider ID" }),
	).toHaveValue("xiaomitokenplancn");
	const fetchModels = page.getByRole("button", { name: "Fetch models" });
	await expect(fetchModels).toBeEnabled();
	const modelNames = page.getByRole("textbox", { name: "Model name" });
	await expect(modelNames).toHaveCount(1);
	await page.getByRole("button", { name: "Add model" }).click();
	await expect(modelNames).toHaveCount(2);
});

test("adds a second model row from the empty provider form", async ({
	page,
}) => {
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await route.fulfill({ json: [] });
		},
	});

	await page.goto("/inference-providers");
	await page.getByRole("button", { name: "Add Provider" }).first().click();

	const modelNames = page.getByRole("textbox", { name: "Model name" });
	await expect(modelNames).toHaveCount(1);
	await page.getByRole("button", { name: "Add model" }).click();
	await expect(modelNames).toHaveCount(2);
});

test("groups fetched bare model IDs by maintained vendor families", async ({
	page,
}) => {
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await route.fulfill({
				json: [
					"audio1.0",
					"babbage-002",
					"claude-fable-5",
					"mimo-v2-flash",
				],
			});
		},
	});

	await openCreateProviderForm(page, "https://yunwu.ai/v1", "");
	await page
		.locator("button")
		.filter({ hasText: /^Fetch models$/ })
		.click();

	for (const group of ["OpenAI", "Anthropic", "Xiaomi", "Uncategorized"]) {
		await expect(
			page.getByRole("button", {
				name: new RegExp(`^${group} 1 model`),
			}),
		).toBeVisible();
	}
});

test("selects individual and visible provider models from their checkbox controls", async ({
	page,
}) => {
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			await route.fulfill({
				json: ["gpt-4.1", "gpt-4o", "claude-sonnet-4"],
			});
		},
	});

	await openCreateProviderForm(page, "https://public.example.com/v1", "");
	await page
		.locator("button")
		.filter({ hasText: /^Fetch models$/ })
		.click();

	const openAiModel = page.getByRole("checkbox", {
		name: 'Select "gpt-4.1"',
	});
	const openAiModelField = page
		.locator('[data-slot="checkbox"]')
		.filter({ has: openAiModel });
	await openAiModelField.locator('[data-slot="checkbox-control"]').click();
	await expect(openAiModel).toBeChecked();
	await expect(page.getByText("1 of 3 selected")).toBeVisible();

	const searchModels = page.getByRole("searchbox", {
		name: "Search models",
	});
	await searchModels.fill("gpt");

	const selectAll = page.getByRole("checkbox", {
		name: "Select all visible models",
	});
	const selectAllField = page
		.locator('[data-slot="checkbox"]')
		.filter({ has: selectAll });
	await selectAllField.locator('[data-slot="checkbox-control"]').click();
	await expect(page.getByText("2 of 3 selected")).toBeVisible();

	await searchModels.fill("");
	await expect(
		page.getByRole("checkbox", { name: 'Select "claude-sonnet-4"' }),
	).not.toBeChecked();
	await expect(selectAll).toHaveJSProperty("indeterminate", true);
});

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
	await expect(fetchModels).toBeEnabled();
	await expect(
		page.getByText(
			"Request URL preview: https://api.example.com/v1/responses",
		),
	).toBeVisible();

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

test("fetches models anonymously when the API key is empty", async ({
	page,
}) => {
	let modelsRequest: unknown;
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			modelsRequest = route.request().postDataJSON();
			await route.fulfill({ json: ["public-model"] });
		},
	});

	await page.goto("/inference-providers");
	await page.getByRole("button", { name: "Add Provider" }).first().click();
	await page
		.getByRole("textbox", { name: "API Base URL" })
		.fill("https://public.example.com");

	const fetchModels = page.locator("button").filter({
		hasText: /^Fetch models$/,
	});
	await expect(fetchModels).toBeEnabled();
	await fetchModels.click();

	await expect
		.poll(() => modelsRequest)
		.toEqual({
			format: "openai_responses",
			api_base_url: "https://public.example.com",
			api_key: null,
			provider_id: null,
		});
	await expect(page.getByRole("textbox", { name: "Model name" })).toHaveValue(
		"public-model",
	);
	const fetchToast = page.getByRole("alertdialog", {
		name: "Added 1 new model(s) (1 returned)",
	});
	await fetchToast.getByRole("button", { name: "Close" }).click();
	await expect(fetchToast).toBeHidden();
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page.getByText("Enter an API key.")).toBeVisible();
});

test("updates the request preview and key scope when the format changes", async ({
	page,
}) => {
	let modelsRequest: unknown;
	await installProviderDiscoveryMocks(page, {
		onFetchModels: async (route) => {
			modelsRequest = route.request().postDataJSON();
			await route.fulfill({ json: ["claude-test"] });
		},
	});

	await openCreateProviderForm(page, "https://api.example.com", "openai-key");
	const fetchModels = page.getByRole("button", { name: "Fetch models" });
	await expect(
		page.getByText(
			"Request URL preview: https://api.example.com/v1/responses",
		),
	).toBeVisible();

	await page
		.locator('[data-slot="select-trigger"]')
		.filter({ hasText: "OpenAI Responses" })
		.click();
	await page
		.getByRole("option")
		.filter({ hasText: "Anthropic Messages API" })
		.click();

	await expect(
		page.getByText(
			"Request URL preview: https://api.example.com/v1/messages",
		),
	).toBeVisible();
	await expect(fetchModels).toBeDisabled();
	await expect(
		page.getByText(
			"The API URL or format changed. Re-enter the API key before fetching models.",
		),
	).toBeVisible();

	await page.getByRole("textbox", { name: "API Key" }).fill("anthropic-key");
	await expect(fetchModels).toBeEnabled();
	await fetchModels.click();
	await expect
		.poll(() => modelsRequest)
		.toEqual({
			format: "anthropic",
			api_base_url: "https://api.example.com",
			api_key: "anthropic-key",
			provider_id: null,
		});
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
			"The API URL or format changed. Re-enter the API key before saving.",
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

	const apiBaseUrl = page.getByRole("textbox", { name: "API Base URL" });
	modelsRequest = undefined;
	await apiBaseUrl.fill("https://other.example.com/v1");
	await expect(fetchModels).toBeEnabled();
	await fetchModels.click();
	await expect
		.poll(() => modelsRequest)
		.toEqual({
			format: "openai_responses",
			api_base_url: "https://other.example.com/v1",
			api_key: null,
			provider_id: null,
		});
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		page.getByText(
			"The API URL or format changed. Re-enter the API key before saving.",
		),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Update agent configs?" }),
	).toHaveCount(0);

	await apiBaseUrl.fill("https://api.example.com/v1");
	await page.getByRole("textbox", { name: "API Key" }).fill("old-scope-key");
	await apiBaseUrl.fill("https://other.example.com/v1");
	await expect(fetchModels).toBeDisabled();
	await expect(
		page.getByText(
			"The API URL or format changed. Re-enter the API key before fetching models.",
		),
	).toBeVisible();
	const disabledReasonId = await fetchModels.getAttribute("aria-describedby");
	expect(disabledReasonId).toBeTruthy();
	await expect(page.locator(`[id="${disabledReasonId}"]`)).toContainText(
		"The API URL or format changed. Re-enter the API key before fetching models.",
	);

	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		page.getByText(
			"The API URL or format changed. Re-enter the API key before saving.",
		),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Update agent configs?" }),
	).toHaveCount(0);

	const apiKey = page.getByRole("textbox", { name: "API Key" });
	await expect(apiKey).toHaveAttribute("aria-required", "true");
	await expect(apiKey).toHaveAttribute("placeholder", "sk-...");

	await apiBaseUrl.fill("https://api.example.com/v1");
	await expect(
		page.getByText(
			"The API URL or format changed. Re-enter the API key before fetching models.",
		),
	).toHaveCount(0);
	await expect(apiKey).not.toHaveAttribute("aria-required", "true");
	await expect(apiKey).toHaveAttribute(
		"placeholder",
		"Leave empty to keep current key",
	);
	await expect(fetchModels).toBeEnabled();

	await apiBaseUrl.fill("https://other.example.com/v1");
	await expect(apiKey).toHaveAttribute("aria-required", "true");
	await apiKey.fill("replacement-key");
	await expect(fetchModels).toBeEnabled();
	modelsRequest = undefined;
	await fetchModels.click();
	await expect
		.poll(() => modelsRequest)
		.toEqual({
			format: "openai_responses",
			api_base_url: "https://other.example.com/v1",
			api_key: "replacement-key",
			provider_id: null,
		});
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
	await page.getByRole("button", { name: "Save", exact: true }).click();

	await expect(
		page.getByText(
			"The API URL or format changed. Re-enter the API key before saving.",
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
		"Failed to fetch models: The provider timed out while listing models.",
	);
	const errorId = await fetchModels.getAttribute("aria-describedby");
	expect(errorId).toBeTruthy();
	await expect(page.locator(`[id="${errorId}"]`)).toHaveAttribute(
		"role",
		"alert",
	);
});

for (const upstreamFailure of [
	{
		code: "UPSTREAM_ACCESS_DENIED",
		responseStatus: 422,
		status: 401,
		apiKey: "",
		message:
			"The provider rejected the model list request. Check the API key and its permissions.",
	},
	{
		code: "MODEL_DISCOVERY_UNSUPPORTED",
		responseStatus: 422,
		status: 404,
		apiKey: "test-key",
		message:
			"The model list endpoint was not found. Check the API Base URL, or add model IDs manually.",
	},
	{
		code: "UPSTREAM_RATE_LIMITED",
		responseStatus: 429,
		status: 429,
		apiKey: "test-key",
		message:
			"The model list request was rate-limited. Try again later or check the provider quota.",
	},
]) {
	test(`explains upstream model discovery HTTP ${upstreamFailure.status}`, async ({
		page,
	}) => {
		await installProviderDiscoveryMocks(page, {
			onFetchModels: async (route) => {
				await route.fulfill({
					status: upstreamFailure.responseStatus,
					json: {
						code: upstreamFailure.code,
						error: `model list endpoint returned HTTP ${upstreamFailure.status}`,
					},
				});
			},
		});
		await openCreateProviderForm(
			page,
			"https://api.example.com/v1",
			upstreamFailure.apiKey,
		);
		const modelName = page.getByRole("textbox", { name: "Model name" });
		await modelName.fill("manual-model");

		await page
			.locator("button")
			.filter({ hasText: /^Fetch models$/ })
			.click();

		await expect(page.getByRole("alert")).toContainText(
			`Failed to fetch models: ${upstreamFailure.message}`,
		);
		await expect(modelName).toHaveValue("manual-model");
	});
}

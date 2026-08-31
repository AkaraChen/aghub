import { expect, test } from "@playwright/test";
import type { MarketMcpServer } from "../src/generated/dto";
import { e2eApiUrl, installMocks } from "./mocks";

test("OCI installation forwards configured names and redacts its preview", async ({
	page,
}) => {
	const mocks = await installMocks(page);
	const fields = ["API_KEY", "REGION", "OPTIONAL_TOKEN"];
	const server: MarketMcpServer = {
		name: "io.example/container",
		display_name: "Container MCP",
		suggested_name: "container",
		publisher: "io.example",
		description: "Container installation fixture",
		version: "1.0.0",
		repository_url: null,
		catalog_url: "https://registry.example.test/",
		install_methods: [
			{
				id: "oci:ghcr.io/example/mcp:1.0.0",
				label: "OCI · ghcr.io/example/mcp:1.0.0",
				transport: {
					type: "stdio",
					command: "docker",
					args: [
						...["run", "-i", "--rm"].map((template) => ({
							name: null,
							value: { template, variables: {} },
						})),
						...fields.map((name) => ({
							name: "--env",
							value: { template: name, variables: {} },
							requires_env: name,
						})),
						{
							name: null,
							value: {
								template: "ghcr.io/example/mcp:1.0.0",
								variables: {},
							},
						},
					],
					env: fields.map((name) => ({
						name,
						value: {
							template: "{value}",
							variables: { value: name },
						},
					})),
				},
				inputs: fields.map((name) => ({
					id: name,
					label: name,
					default: name === "REGION" ? "eu-west-1" : null,
					placeholder: null,
					description: null,
					is_required: name === "API_KEY",
					is_secret: name !== "REGION",
					format: "string",
					choices: [],
				})),
			},
		],
	};
	await page.route(e2eApiUrl("/mcp-market/search**"), (route) =>
		route.fulfill({ json: [server] }),
	);
	await page.goto("/market?tab=mcp");
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Install MCP server" });
	await dialog.getByText("Claude", { exact: true }).click();
	await expect(
		dialog.getByRole("button", { name: "Install", exact: true }),
	).toBeDisabled();
	await dialog.getByLabel(/API_KEY/).fill("test-container-secret");
	await dialog.getByLabel(/OPTIONAL_TOKEN/).fill("   ");
	await expect(dialog.locator("pre")).toContainText("--env=API_KEY");
	await expect(dialog.locator("pre")).toContainText("--env=REGION");
	await expect(dialog.locator("pre")).not.toContainText("OPTIONAL_TOKEN");
	await expect(dialog.locator("pre")).not.toContainText(
		"test-container-secret",
	);
	await dialog.getByRole("button", { name: "Install", exact: true }).click();
	await expect(dialog.getByText("Installed successfully")).toBeVisible();
	expect(mocks.mcpCreates).toHaveLength(1);
	expect(mocks.mcpCreates[0]).toMatchObject({
		agent: "claude",
		body: {
			transport: {
				type: "stdio",
				command: "docker",
				args: [
					"run",
					"-i",
					"--rm",
					"--env=API_KEY",
					"--env=REGION",
					"ghcr.io/example/mcp:1.0.0",
				],
				env: { API_KEY: "test-container-secret", REGION: "eu-west-1" },
			},
		},
	});
	await dialog.getByRole("button", { name: "Done" }).click();
	await expect(
		page.getByRole("button", { name: "Installed", exact: true }),
	).toBeVisible();
});

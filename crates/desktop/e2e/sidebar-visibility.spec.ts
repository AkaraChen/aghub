import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	normalizeSidebarItems,
	resolveSidebarSections,
} from "../src/lib/sidebar-navigation";
import type { SidebarItemPreference } from "../src/lib/store";
import { installMocks } from "./mocks";

const STORED_ITEMS = [
	{ id: "market", visible: false },
	{ id: "home", visible: true },
	{ id: "skills", visible: false },
	{ id: "home", visible: false },
	{ id: "removed-item", visible: false },
] as unknown as SidebarItemPreference[];

const CUSTOMIZABLE_SIDEBAR_ITEMS = [
	"Home",
	"Market",
	"Usage",
	"Skills",
	"MCP Servers",
	"Sub-agents",
	"Prompts",
	"Claude Code Plugins",
	"Inference Providers",
] as const;

test("stored sidebar preferences preserve visibility but not order", () => {
	const items = normalizeSidebarItems(STORED_ITEMS);

	expect(items).toEqual([
		{ id: "home", visible: true },
		{ id: "market", visible: false },
		{ id: "usage", visible: true },
		{ id: "skills", visible: false },
		{ id: "mcp", visible: true },
		{ id: "subAgents", visible: true },
		{ id: "prompts", visible: true },
		{ id: "ccPlugins", visible: true },
		{ id: "inferenceProviders", visible: true },
	]);
	expect(
		resolveSidebarSections(items).map((section) => ({
			id: section.id,
			items: section.items.map((item) => item.id),
		})),
	).toEqual([
		{ id: "primary", items: ["home", "market", "usage"] },
		{
			id: "resources",
			items: ["skills", "mcp", "subAgents", "prompts", "ccPlugins"],
		},
		{ id: "providers", items: ["inferenceProviders"] },
	]);
});

async function toggleSidebarItem(panel: Locator, name: string) {
	const checkbox = panel.getByRole("checkbox", { name });

	await checkbox.focus();
	await checkbox.press("Space");
}

test("appearance controls update grouped sidebar visibility", async ({
	page,
}) => {
	await installMocks(page);
	await page.goto("/settings?tab=appearance");

	const sidebar = page.getByRole("complementary");
	const panel = page.getByRole("group", { name: "Sidebar" });

	await expect(panel.getByRole("checkbox")).toHaveCount(
		CUSTOMIZABLE_SIDEBAR_ITEMS.length,
	);
	for (const name of CUSTOMIZABLE_SIDEBAR_ITEMS) {
		await expect(panel.getByRole("checkbox", { name })).toBeVisible();
	}
	await toggleSidebarItem(panel, "Market");
	await expect(sidebar.getByRole("link", { name: "Market" })).toHaveCount(0);
	await expect(sidebar.getByRole("link", { name: "Settings" })).toBeVisible();

	await page.evaluate(() => {
		window.history.pushState({}, "", "/market");
		window.dispatchEvent(new PopStateEvent("popstate"));
	});
	await expect(page.getByRole("heading", { name: "Market" })).toBeVisible();
	await sidebar.getByRole("link", { name: "Settings" }).click();
	await expect(
		panel.getByRole("checkbox", { name: "Market" }),
	).not.toBeChecked();
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(
		panel.getByRole("checkbox", { name: "Market" }),
	).not.toBeChecked();
	await expect(sidebar.getByRole("link", { name: "Market" })).toHaveCount(0);

	for (const name of [
		"Skills",
		"MCP Servers",
		"Sub-agents",
		"Prompts",
		"Claude Code Plugins",
	]) {
		await toggleSidebarItem(panel, name);
	}
	await expect(sidebar.getByText("Resources", { exact: true })).toHaveCount(
		0,
	);
	await expect(sidebar.locator("hr")).toHaveCount(2);

	await panel.getByRole("button", { name: "Restore defaults" }).click();
	await expect(sidebar.getByRole("link", { name: "Market" })).toBeVisible();
	await expect(sidebar.getByText("Resources", { exact: true })).toBeVisible();
});

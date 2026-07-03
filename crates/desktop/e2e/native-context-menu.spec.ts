import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

test("native context menu is suppressed except in editable fields", async ({
	page,
}) => {
	await installMocks(page);
	await page.goto("/skills");
	await page.getByRole("option", { name: "solo-skill" }).waitFor();

	const preventedFor = (selector: string) =>
		page.evaluate((sel) => {
			const el = document.querySelector(sel);
			if (!el) throw new Error(`missing element: ${sel}`);
			return new Promise<boolean>((resolve) => {
				const handler = (e: Event) => {
					window.removeEventListener("contextmenu", handler);
					resolve(e.defaultPrevented);
				};
				window.addEventListener("contextmenu", handler);
				el.dispatchEvent(
					new MouseEvent("contextmenu", {
						bubbles: true,
						cancelable: true,
					}),
				);
			});
		}, selector);

	// A plain element: the app cancels the native menu
	expect(await preventedFor('[role="option"]')).toBe(true);
	// An editable field: the native cut/copy/paste menu is left alone
	expect(await preventedFor("input")).toBe(false);
});

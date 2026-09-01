import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

const tabBoxes = async (page: import("@playwright/test").Page) =>
	page
		.getByRole("tablist", { name: "Settings sections" })
		.getByRole("tab")
		.evaluateAll((tabs) =>
			tabs.map((tab) => {
				const box = tab.getBoundingClientRect();
				return {
					bottom: box.bottom,
					left: box.left,
					right: box.right,
					top: box.top,
				};
			}),
		);

test("settings navigation uses two connected right-aligned rows at the minimum window width", async ({
	page,
}) => {
	await installMocks(page);
	await page.setViewportSize({ width: 1024, height: 600 });
	await page.goto("/settings?tab=appearance");

	const tabList = page.getByRole("tablist", {
		name: "Settings sections",
	});
	await expect(tabList).toHaveAttribute("data-row-count", "2");

	const boxes = await tabBoxes(page);
	const rowTops = [...new Set(boxes.map(({ top }) => top))];
	expect(rowTops).toHaveLength(2);

	const rows = rowTops.map((top) => boxes.filter((box) => box.top === top));
	expect(Math.max(...rows[0].map(({ right }) => right))).toBeCloseTo(
		Math.max(...rows[1].map(({ right }) => right)),
		0,
	);
	expect(Math.min(...rows[1].map(({ left }) => left))).toBeGreaterThan(
		Math.min(...rows[0].map(({ left }) => left)),
	);
	const connection = await tabList.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			rowOneBottom:
				Number.parseFloat(
					style.getPropertyValue("--settings-tabs-row-1-top"),
				) +
				Number.parseFloat(
					style.getPropertyValue("--settings-tabs-row-1-height"),
				),
			rowTwoTop: Number.parseFloat(
				style.getPropertyValue("--settings-tabs-row-2-top"),
			),
		};
	});
	expect(connection.rowOneBottom).toBeCloseTo(connection.rowTwoTop, 0);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);

	const rulesTab = tabList.getByRole("tab", { name: "Rules" });
	await rulesTab.focus();
	await rulesTab.press("ArrowRight");
	await expect(tabList.getByRole("tab", { name: "Logs" })).toBeFocused();
});

test("settings navigation stays on one row at the default window width", async ({
	page,
}) => {
	await installMocks(page);
	await page.setViewportSize({ width: 1200, height: 800 });
	await page.goto("/settings?tab=appearance");

	const tabList = page.getByRole("tablist", {
		name: "Settings sections",
	});
	await expect(tabList).toHaveAttribute("data-row-count", "1");
	expect(new Set((await tabBoxes(page)).map(({ top }) => top)).size).toBe(1);
});

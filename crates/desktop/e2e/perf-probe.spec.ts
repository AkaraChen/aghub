import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

// Manual performance probe — skipped by default, run with:
//   PERF=1 bunx playwright test e2e/perf-probe.spec.ts
// Builds a large dataset (250 loose skills + 20 source clusters x 5) and
// prints context-menu latency and drag frame times to the console. No
// assertions on the numbers: they are dev-build wall clock and would be
// flaky as CI gates — compare runs on the same machine instead.
test.skip(
	!process.env.PERF,
	"manual performance probe — run with PERF=1 to measure",
);

const skill = (name: string) => ({
	name,
	enabled: true,
	source_path: `/tmp/e2e/.claude/skills/${name}/SKILL.md`,
	canonical_path: `/tmp/e2e/.claude/skills/${name}`,
	description: `${name} description`,
	author: null,
	version: null,
	tools: [],
	source: "global",
	agent: "claude",
});

const lockEntry = (name: string, source: string) => ({
	name,
	source,
	sourceType: "github",
	sourceUrl: `https://github.com/${source.replace(/^github\//, "")}`,
	skillPath: null,
	skillFolderHash: "hash",
	installedAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	pluginName: null,
});

function bigDataset() {
	const skills = [];
	const lock = [];
	for (let i = 0; i < 250; i++)
		skills.push(skill(`loose-skill-${String(i).padStart(3, "0")}`));
	for (let g = 0; g < 20; g++) {
		const source = `github/acme/pack-${String(g).padStart(2, "0")}`;
		for (let m = 0; m < 5; m++) {
			const name = `pack-${String(g).padStart(2, "0")}-member-${m}`;
			skills.push(skill(name));
			lock.push(lockEntry(name, source));
		}
	}
	return {
		skills,
		lock: { version: 1, skills: lock, lastSelectedAgents: null },
	};
}

test.beforeEach(async ({ page }) => {
	await installMocks(page);
	const { skills, lock } = bigDataset();
	await page.route("**/api/v1/agents/all/skills**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(skills),
		}),
	);
	await page.route("**/api/v1/skills/lock/global**", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(lock),
		}),
	);
	await page.goto("/skills");
	await expect(
		page.getByRole("option", { name: "loose-skill-000" }),
	).toBeVisible();
});

/** Dispatch contextmenu on the row's inner draggable div and stop the
 * clock when the menu is in the DOM and painted (double rAF). */
async function measureContextMenu(
	page: import("@playwright/test").Page,
	rowName: string,
) {
	return page.evaluate(async (name) => {
		const row = Array.from(
			document.querySelectorAll('[role="option"]'),
		).find((el) => el.textContent?.includes(name));
		const inner = row?.querySelector("div");
		if (!inner) return -1;
		const rect = inner.getBoundingClientRect();
		const start = performance.now();
		inner.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: rect.left + 40,
				clientY: rect.top + 10,
			}),
		);
		await new Promise<void>((resolve) => {
			const check = () => {
				if (document.querySelector('[role="menu"]')) {
					requestAnimationFrame(() =>
						requestAnimationFrame(() => resolve()),
					);
				} else {
					requestAnimationFrame(check);
				}
			};
			check();
		});
		return performance.now() - start;
	}, rowName);
}

test("context menu latency", async ({ page }) => {
	const rows = [
		"loose-skill-001",
		"loose-skill-003",
		"loose-skill-005",
		"loose-skill-007",
		"loose-skill-009",
	];
	const fresh: number[] = [];
	const reopen: number[] = [];
	for (const name of rows) {
		const t = await measureContextMenu(page, name);
		fresh.push(t);
		await page.keyboard.press("Escape");
		await expect(page.getByRole("menu")).toBeHidden();
		// reopen on the SAME (now selected) row — selection unchanged
		const t2 = await measureContextMenu(page, name);
		reopen.push(t2);
		await page.keyboard.press("Escape");
		await expect(page.getByRole("menu")).toBeHidden();
	}
	const fmt = (xs: number[]) => xs.map((x) => x.toFixed(0)).join(" ");
	console.log(`CTX fresh (selection changes): ${fmt(fresh)} ms`);
	console.log(`CTX reopen (same selection):   ${fmt(reopen)} ms`);
});

test("drag frame times", async ({ page }) => {
	const row = page.getByRole("option", { name: "loose-skill-002" });
	await row.scrollIntoViewIfNeeded();
	const box = await row.boundingBox();
	if (!box) throw new Error("row not found");

	await page.evaluate(() => {
		const w = window as unknown as {
			__frames: number[];
			__longTasks: number[];
			__framesOn: boolean;
		};
		w.__frames = [];
		w.__longTasks = [];
		w.__framesOn = true;
		let last = performance.now();
		const loop = (t: number) => {
			w.__frames.push(t - last);
			last = t;
			if (w.__framesOn) requestAnimationFrame(loop);
		};
		requestAnimationFrame(loop);
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) w.__longTasks.push(e.duration);
		}).observe({ entryTypes: ["longtask"] });
	});

	const startX = box.x + box.width / 2;
	const startY = box.y + box.height / 2;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	// activate (distance 8) then sweep the list
	await page.mouse.move(startX + 12, startY + 12, { steps: 3 });
	await expect(page.getByTestId("new-group-dropzone")).toBeAttached();
	for (let pass = 0; pass < 3; pass++) {
		await page.mouse.move(startX + 20, startY + 250, { steps: 15 });
		await page.mouse.move(startX + 20, startY - 50, { steps: 15 });
	}
	const stats = await page.evaluate(() => {
		const w = window as unknown as {
			__frames: number[];
			__longTasks: number[];
			__framesOn: boolean;
		};
		w.__framesOn = false;
		const xs = [...w.__frames].sort((a, b) => a - b);
		const q = (p: number) => xs[Math.floor(xs.length * p)] ?? 0;
		return {
			n: xs.length,
			p50: q(0.5),
			p90: q(0.9),
			p99: q(0.99),
			max: xs[xs.length - 1] ?? 0,
			over32: xs.filter((x) => x > 32).length,
			longTasks: w.__longTasks.map((d) => Math.round(d)),
		};
	});
	await page.mouse.up();
	console.log(
		`DRAG frames n=${stats.n} p50=${stats.p50.toFixed(1)} p90=${stats.p90.toFixed(1)} p99=${stats.p99.toFixed(1)} max=${stats.max.toFixed(1)} over32ms=${stats.over32}`,
	);
	console.log(`DRAG long tasks: ${stats.longTasks.join(" ")}`);
});

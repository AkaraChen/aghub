import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	fullyParallel: false,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [["list"], ["html", { open: "never" }]]
		: [["list"]],
	use: {
		baseURL: "http://localhost:1420",
		locale: "en-US",
		trace: "retain-on-failure",
		// Animation never participates in assertions; the app honors this
		// via the reduced-motion media query.
		reducedMotion: "reduce",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "bun run dev",
		url: "http://localhost:1420",
		// Never adopt whatever happens to listen on 1420 — a dev server from
		// another checkout (e.g. a .claude/worktrees clone) serves different
		// code and the suite silently tests that instead. If the port is
		// taken, vite's strictPort fails loudly: stop that server first.
		reuseExistingServer: false,
		timeout: 60_000,
	},
});

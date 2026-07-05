import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	fullyParallel: false,
	retries: process.env.CI ? 1 : 0,
	reporter: [["list"]],
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
		reuseExistingServer: true,
		timeout: 60_000,
	},
});

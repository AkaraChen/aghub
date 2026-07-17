import path from "node:path";
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
	webServer: [
		{
			command: "bun run dev",
			url: "http://localhost:1420",
			// Never adopt whatever happens to listen on 1420 — a dev server
			// from another checkout (e.g. a .claude/worktrees clone) serves
			// different code and the suite silently tests that instead. If
			// the port is taken, vite's strictPort fails loudly: stop that
			// server first.
			reuseExistingServer: false,
			timeout: 60_000,
		},
		{
			// The real API server on the port the Tauri mock hands to the
			// frontend, driving a fixture ccusage — the usage pipeline test
			// exercises real ccusage JSON through the Rust parsers. Port
			// probe (not url): every route sits behind auth.
			command:
				"cargo run --quiet --manifest-path ../api/Cargo.toml --bin aghub-api",
			port: 45999,
			env: {
				// Spread: playwright replaces (not merges) the child env, and
				// cargo needs PATH & co.
				...process.env,
				AGHUB_API_PORT: "45999",
				AGHUB_API_TOKEN: "e2e-token",
				// cwd is this config's directory when playwright runs.
				AGHUB_CCUSAGE_BIN: path.resolve(
					"e2e/fixtures/fake-ccusage.mjs",
				),
			},
			reuseExistingServer: false,
			// Incremental runs boot in seconds; a cold target does not fit
			// this budget — run `cargo build -p aghub-api` once first.
			timeout: 300_000,
		},
	],
});

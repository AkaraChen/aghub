#!/usr/bin/env node
// A stand-in ccusage binary for the e2e pipeline test. Speaks the real CLI
// surface the backend drives — `<agent> daily --json …` and `--version` —
// and prints reports in ccusage's actual JSON shapes (camelCase fields;
// codex uses the 20.0.14+ names), so the Rust parsers run against the same
// format the real tool emits. Dates are relative so the strip always has
// in-window data.

import process from "node:process";

const args = process.argv.slice(2);
const emit = (line) => process.stdout.write(`${line}\n`);

if (args.includes("--version")) {
	emit("99.0.0-e2e");
	process.exit(0);
}

const ymd = (daysAgo) => {
	const d = new Date();
	d.setDate(d.getDate() - daysAgo);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate(),
	).padStart(2, "0")}`;
};

const claude = {
	daily: [
		{
			date: ymd(2),
			inputTokens: 400_000,
			outputTokens: 120_000,
			cacheCreationTokens: 10_000,
			cacheReadTokens: 400_000,
			totalTokens: 930_000,
			totalCost: 9.5,
			modelBreakdowns: [
				{
					modelName: "claude-opus-4",
					inputTokens: 400_000,
					outputTokens: 120_000,
					cacheCreationTokens: 10_000,
					cacheReadTokens: 400_000,
					cost: 9.5,
				},
			],
		},
		{
			date: ymd(1),
			inputTokens: 5_000,
			outputTokens: 3_000,
			cacheCreationTokens: 0,
			cacheReadTokens: 5_000,
			totalTokens: 13_000,
			// null cost: ccusage emits this for models it can't price.
			totalCost: null,
			modelBreakdowns: [],
		},
	],
	totals: {
		inputTokens: 405_000,
		outputTokens: 123_000,
		cacheCreationTokens: 10_000,
		cacheReadTokens: 405_000,
		totalTokens: 943_000,
		totalCost: 12.5,
	},
};

const codex = {
	daily: [
		{
			date: ymd(1),
			inputTokens: 200_000,
			cacheReadTokens: 40_000,
			cacheCreationTokens: 0,
			outputTokens: 80_000,
			reasoningOutputTokens: 20_000,
			totalTokens: 340_000,
			costUSD: 0.5,
			models: {
				"gpt-5": {
					inputTokens: 200_000,
					cacheReadTokens: 40_000,
					cacheCreationTokens: 0,
					outputTokens: 80_000,
					reasoningOutputTokens: 20_000,
					totalTokens: 340_000,
				},
			},
		},
	],
	totals: {
		inputTokens: 200_000,
		cacheReadTokens: 40_000,
		cacheCreationTokens: 0,
		outputTokens: 80_000,
		reasoningOutputTokens: 20_000,
		totalTokens: 340_000,
		costUSD: 0.5,
	},
};

const droid = {
	daily: [
		{
			date: ymd(1),
			inputTokens: 1_000,
			totalTokens: 1_000,
		},
	],
	totals: {
		inputTokens: 1_000,
		totalTokens: 1_000,
	},
};

/** Agents with no local data: ccusage still exits 0 with an empty report. */
const empty = {
	daily: [],
	totals: {
		inputTokens: 0,
		outputTokens: 0,
		cacheCreationTokens: 0,
		cacheReadTokens: 0,
		totalTokens: 0,
		totalCost: 0,
	},
};

const agent = args[0];
if (agent === "claude") emit(JSON.stringify(claude));
else if (agent === "codex") emit(JSON.stringify(codex));
else if (agent === "droid") emit(JSON.stringify(droid));
else emit(JSON.stringify(empty));

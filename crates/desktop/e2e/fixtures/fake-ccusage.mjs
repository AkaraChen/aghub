#!/usr/bin/env node
// A stand-in ccusage binary for the e2e pipeline test. Speaks the real CLI
// surface the backend drives — `<agent> daily --json …` and `--version` —
// and prints reports aligned with ccusage's JSON snapshots at 31e084af
// (camelCase fields; Codex uses cacheReadTokens/cacheCreationTokens). Dates
// remain relative so the strip always has in-window data.

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
			inputTokens: 1_234,
			outputTokens: 567,
			cacheCreationTokens: 89,
			cacheReadTokens: 10,
			totalTokens: 1_900,
			totalCost: 0.42,
			modelsUsed: ["gpt-5.2-codex", "claude-sonnet-4-20250514"],
			modelBreakdowns: [
				{
					modelName: "gpt-5.2-codex",
					inputTokens: 900,
					outputTokens: 300,
					cacheCreationTokens: 50,
					cacheReadTokens: 10,
					cost: 0.3,
				},
				{
					modelName: "claude-sonnet-4-20250514",
					inputTokens: 334,
					outputTokens: 267,
					cacheCreationTokens: 39,
					cacheReadTokens: 0,
					cost: 0.12,
				},
			],
		},
	],
	totals: {
		inputTokens: 1_234,
		outputTokens: 567,
		cacheCreationTokens: 89,
		cacheReadTokens: 10,
		totalTokens: 1_900,
		totalCost: 0.42,
	},
};

const codex = {
	daily: [
		{
			date: ymd(2),
			inputTokens: 100,
			cacheReadTokens: 110,
			cacheCreationTokens: 0,
			outputTokens: 15,
			reasoningOutputTokens: 2,
			totalTokens: 227,
			costUSD: 0.00040425,
			models: {
				"gpt-5.3-codex": {
					inputTokens: 100,
					cacheReadTokens: 110,
					cacheCreationTokens: 0,
					outputTokens: 15,
					reasoningOutputTokens: 2,
					totalTokens: 227,
					isFallback: true,
				},
			},
		},
		{
			date: ymd(1),
			inputTokens: 10,
			cacheReadTokens: 0,
			cacheCreationTokens: 0,
			outputTokens: 2,
			reasoningOutputTokens: 0,
			totalTokens: 12,
			costUSD: 0.0000065,
			models: {
				"gpt-5-mini": {
					inputTokens: 10,
					cacheReadTokens: 0,
					cacheCreationTokens: 0,
					outputTokens: 2,
					reasoningOutputTokens: 0,
					totalTokens: 12,
					isFallback: false,
				},
			},
		},
	],
	totals: {
		inputTokens: 110,
		cacheReadTokens: 110,
		cacheCreationTokens: 0,
		outputTokens: 17,
		reasoningOutputTokens: 2,
		totalTokens: 239,
		costUSD: 0.00041075,
	},
};

const droid = {
	daily: [
		{
			date: ymd(1),
			inputTokens: 100,
			outputTokens: 50,
			cacheCreationTokens: 10,
			cacheReadTokens: 5,
			totalTokens: 172,
			totalCost: 0.25,
			credits: 1.5,
			messageCount: 3,
			modelsUsed: ["gpt-5.2-codex", "claude-sonnet-4-20250514"],
			modelBreakdowns: [
				{
					modelName: "gpt-5.2-codex",
					inputTokens: 100,
					outputTokens: 50,
					cacheCreationTokens: 10,
					cacheReadTokens: 5,
					cost: 0.25,
				},
			],
		},
	],
	totals: {
		inputTokens: 100,
		outputTokens: 50,
		cacheCreationTokens: 10,
		cacheReadTokens: 5,
		totalTokens: 172,
		totalCost: 0.25,
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

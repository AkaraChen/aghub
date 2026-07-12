import antfu from "@antfu/eslint-config";
import eslintReact from "@eslint-react/eslint-plugin";
import tailwind from "eslint-plugin-better-tailwindcss";

const baseConfig = await antfu({
	react: false,
	stylistic: false,
	imports: false,
	// A pnpm-workspace.yaml anywhere up the tree (even outside the repo) makes
	// antfu auto-enable eslint-plugin-pnpm, whose --fix rewrites package.json
	// deps to broken `catalog:` refs. This is a bun workspace — never enable it.
	pnpm: false,
})
	.removePlugins("perfectionist")
	.toConfigs();

export default [
	...baseConfig,
	{
		...eslintReact.configs["recommended-typescript"],
		files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
	},
	{
		...tailwind.configs.correctness,
		settings: {
			"better-tailwindcss": {
				entryPoint: "./src/index.css",
			},
		},
	},
	{
		ignores: ["./src/generated/**"],
	},
	{
		// Named function expressions inside memo() keep the component's
		// displayName in DevTools; the arrow form erases it.
		rules: {
			"prefer-arrow-callback": ["error", { allowNamedFunctions: true }],
		},
	},
	{
		// The perf probe's console output is its product: measured numbers.
		files: ["e2e/perf-probe.spec.ts"],
		rules: {
			"no-console": "off",
		},
	},
];

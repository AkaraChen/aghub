import antfu from "@antfu/eslint-config";
import eslintReact from "@eslint-react/eslint-plugin";
import tailwind from "eslint-plugin-better-tailwindcss";

const baseConfig = await antfu({
	react: false,
	stylistic: false,
	imports: false,
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
];

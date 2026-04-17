import antfu from "@antfu/eslint-config";
import eslintReact from "@eslint-react/eslint-plugin";
import tailwind from "eslint-plugin-better-tailwindcss";

export default antfu({
	react: false,
	stylistic: false,
	imports: false,
})
	.append({
		...eslintReact.configs["recommended-typescript"],
		files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
	})
	.append({
		...tailwind.configs.correctness,
		settings: {
			"better-tailwindcss": {
				entryPoint: "./src/index.css",
			},
		},
	})
	.append({
		ignores: ["./src/generated/**"],
	})
	.removePlugins("perfectionist");

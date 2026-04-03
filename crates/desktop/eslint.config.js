import antfu from "@antfu/eslint-config";
import tailwind from "eslint-plugin-better-tailwindcss";

export default antfu({
	react: true,
	stylistic: false,
	imports: false,
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

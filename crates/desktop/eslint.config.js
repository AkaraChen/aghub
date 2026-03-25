import antfu from "@antfu/eslint-config";

export default antfu({
	react: true,
	stylistic: false,
	imports: false,
}).removePlugins("perfectionist");

import { describe, expect, it } from "vitest";
import { inferModelVendor } from "./model-vendors";

describe("inferModelVendor", () => {
	it.each([
		["gpt-5.4", "openai", "OpenAI"],
		["claude-sonnet-4-6", "anthropic", "Anthropic"],
		["gemini-3.1-pro-preview", "google", "Google"],
		["grok-4.1", "xai", "xAI"],
		["deepseek-r1-distill-qwen-32b", "deepseek", "DeepSeek"],
		["qwen3.5-397b-a17b", "alibaba", "Alibaba"],
		["wan2-2-t2v-a14b", "alibaba", "Alibaba"],
		["meta-llama/llama-4-maverick", "meta", "Meta"],
		["mimo-v2.5-pro", "xiaomi", "Xiaomi"],
		["mistral-large-latest", "mistral", "Mistral AI"],
		["glm-5", "zhipu", "Zhipu AI"],
		["kimi-k2.5", "moonshot", "Moonshot AI"],
		["minimax-m2.5", "minimax", "MiniMax"],
		["doubao-seed-1-6", "bytedance", "ByteDance"],
		["hunyuan-t1", "tencent", "Tencent"],
		["command-r-plus", "cohere", "Cohere"],
		["stable-diffusion-xl", "stability-ai", "Stability AI"],
		["flux-1.1-pro", "black-forest-labs", "Black Forest Labs"],
		["sonar-reasoning-pro", "perplexity", "Perplexity"],
		["phi-4", "microsoft", "Microsoft"],
		["amazon.nova-pro-v1:0", "amazon", "Amazon"],
		["nemotron-3-super", "nvidia", "NVIDIA"],
		["jamba-large-1.7", "ai21", "AI21 Labs"],
		["ernie-5.0-thinking", "baidu", "Baidu"],
		["Baichuan4-Turbo", "baichuan", "Baichuan"],
		["yi-lightning", "01-ai", "01.AI"],
		["solar-pro2", "upstage", "Upstage"],
		["step-3", "stepfun", "StepFun"],
	])("maps %s to %s", (modelId, key, label) => {
		expect(inferModelVendor(modelId)).toEqual({ key, label });
	});

	it("checks specific families before overlapping family names", () => {
		expect(inferModelVendor("deepseek-r1-distill-qwen-7b")).toEqual({
			key: "deepseek",
			label: "DeepSeek",
		});
	});

	it("ignores surrounding whitespace and model ID casing", () => {
		expect(inferModelVendor("  CLAUDE-HAIKU-4-5  ")).toEqual({
			key: "anthropic",
			label: "Anthropic",
		});
	});

	it("recognizes a known family behind gateway namespaces", () => {
		expect(
			inferModelVendor("openrouter/anthropic/claude-opus-4-1"),
		).toEqual({
			key: "anthropic",
			label: "Anthropic",
		});
	});

	it("recognizes a known family after a gateway prefix", () => {
		expect(inferModelVendor("databricks-gpt-5")).toEqual({
			key: "openai",
			label: "OpenAI",
		});
	});

	it("uses the first namespace when no family is known", () => {
		expect(inferModelVendor("Acme/models/model-1")).toEqual({
			key: "acme",
			label: "Acme",
		});
		expect(inferModelVendor("TheDrummer 2/Rocinante-12B")).toEqual({
			key: "thedrummer 2",
			label: "TheDrummer 2",
		});
		expect(inferModelVendor("@cf/ibm-granite/model-1")).toEqual({
			key: "@cf",
			label: "@cf",
		});
	});

	it.each(["", "   ", "audio1.0", "/model-1", "acme/"])(
		"leaves an unidentifiable model unclassified: %s",
		(modelId) => {
			expect(inferModelVendor(modelId)).toBeNull();
		},
	);
});

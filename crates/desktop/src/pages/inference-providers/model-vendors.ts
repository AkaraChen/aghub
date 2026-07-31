interface ModelVendor {
	key: string;
	label: string;
}

interface ModelVendorRule extends ModelVendor {
	pattern: RegExp;
}

const MODEL_VENDOR_RULES: readonly ModelVendorRule[] = [
	{
		key: "deepseek",
		label: "DeepSeek",
		pattern: /(?:^|[/_.-])deepseek(?:[\d_.-]|$)/,
	},
	{
		key: "openai",
		label: "OpenAI",
		pattern:
			/(?:^openai[/_.-]|(?:^|[/_.-])(?:gpt|chatgpt|o[134]|codex|babbage|davinci|dall-e|whisper|tts|sora|omni-moderation|text-embedding)(?:[\d_.-]|$))/,
	},
	{
		key: "anthropic",
		label: "Anthropic",
		pattern: /(?:^anthropic[/_.-]|(?:^|[/_.-])claude(?:[\d_.-]|$))/,
	},
	{
		key: "google",
		label: "Google",
		pattern:
			/(?:^google[/_.-]|(?:^|[/_.-])(?:gemini|gemma|imagen|veo|chirp|chat-bison|code-bison|text-bison)(?:[\d_.-]|$))/,
	},
	{
		key: "xai",
		label: "xAI",
		pattern: /(?:^xai[/_.-]|(?:^|[/_.-])grok(?:[\d_.-]|$))/,
	},
	{
		key: "alibaba",
		label: "Alibaba",
		pattern:
			/(?:^(?:alibaba|qwen)[/_.-]|(?:^|[/_.-])(?:qwen|qwq|qvq|wan|tongyi)(?:[\d_.-]|$))/,
	},
	{
		key: "meta",
		label: "Meta",
		pattern:
			/(?:^meta(?:-llama)?[/_.-]|(?:^|[/_.-])(?:meta-llama|llama)(?:[\d_.-]|$))/,
	},
	{
		key: "xiaomi",
		label: "Xiaomi",
		pattern:
			/(?:^(?:xiaomi|xiaomimimo)[/_.-]|(?:^|[/_.-])(?:xiaomi-mimo|mimo)(?:[-_.]|$))/,
	},
	{
		key: "mistral",
		label: "Mistral AI",
		pattern:
			/(?:^mistral[/_.-]|(?:^|[/_.-])(?:mistral|ministral|mixtral|codestral|devstral|pixtral|magistral|voxtral|open-mistral|open-mixtral)(?:[-_.]|$))/,
	},
	{
		key: "zhipu",
		label: "Zhipu AI",
		pattern:
			/(?:^(?:zhipu|zai)[/_.-]|(?:^|[/_.-])(?:glm|chatglm|codegeex|cogview|cogvideo)(?:[\d_.-]|$))/,
	},
	{
		key: "moonshot",
		label: "Moonshot AI",
		pattern:
			/(?:^(?:moonshot|kimi)[/_.-]|(?:^|[/_.-])(?:moonshot|kimi)(?:[-_.]|$))/,
	},
	{
		key: "minimax",
		label: "MiniMax",
		pattern: /(?:^minimax[/_.-]|(?:^|[/_.-])(?:minimax|abab)(?:[\d_.-]|$))/,
	},
	{
		key: "bytedance",
		label: "ByteDance",
		pattern:
			/(?:^(?:bytedance|volcengine)[/_.-]|(?:^|[/_.-])(?:doubao|seedance|seedream|seed|skylark)(?:[\d_.-]|$))/,
	},
	{
		key: "tencent",
		label: "Tencent",
		pattern: /(?:^tencent[/_.-]|(?:^|[/_.-])hunyuan(?:[\d_.-]|$))/,
	},
	{
		key: "cohere",
		label: "Cohere",
		pattern:
			/(?:^cohere[/_.-]|(?:^|[/_.-])(?:command|c4ai|aya|embed-english|embed-multilingual|rerank-english|rerank-multilingual)(?:[\d_.-]|$))/,
	},
	{
		key: "stability-ai",
		label: "Stability AI",
		pattern:
			/(?:^(?:stability-ai|stabilityai)[/_.-]|(?:^|[/_.-])(?:stable-diffusion|stable-image|stable-video|sd3)(?:[\d_.-]|$))/,
	},
	{
		key: "black-forest-labs",
		label: "Black Forest Labs",
		pattern:
			/(?:^(?:black-forest-labs|bfl)[/_.-]|(?:^|[/_.-])flux(?:[\d_.-]|$))/,
	},
	{
		key: "perplexity",
		label: "Perplexity",
		pattern:
			/(?:^perplexity[/_.-]|(?:^|[/_.-])(?:sonar|pplx)(?:[\d_.-]|$))/,
	},
	{
		key: "microsoft",
		label: "Microsoft",
		pattern:
			/(?:^(?:microsoft|azure)[/_.-]|(?:^|[/_.-])(?:phi|wizardlm)(?:[\d_.-]|$))/,
	},
	{
		key: "amazon",
		label: "Amazon",
		pattern:
			/(?:^(?:amazon|aws)[/_.-]|(?:^|[/_.-])(?:nova|titan)(?:[\d_.:-]|$))/,
	},
	{
		key: "nvidia",
		label: "NVIDIA",
		pattern: /(?:^nvidia[/_.-]|(?:^|[/_.-])nemotron(?:[\d_.:-]|$))/,
	},
	{
		key: "ai21",
		label: "AI21 Labs",
		pattern: /(?:^ai21[/_.-]|(?:^|[/_.-])jamba(?:[\d_.-]|$))/,
	},
	{
		key: "baidu",
		label: "Baidu",
		pattern: /(?:^baidu[/_.-]|(?:^|[/_.-])ernie(?:[\d_.-]|$))/,
	},
	{
		key: "baichuan",
		label: "Baichuan",
		pattern: /(?:^|[/_.-])baichuan(?:[\d_.-]|$)/,
	},
	{
		key: "01-ai",
		label: "01.AI",
		pattern: /(?:^(?:01-ai|zero-one-ai)[/_.-]|(?:^|[/_.-])yi(?:[\d_.-]|$))/,
	},
	{
		key: "upstage",
		label: "Upstage",
		pattern: /(?:^upstage[/_.-]|(?:^|[/_.-])solar(?:[\d_.-]|$))/,
	},
	{
		key: "stepfun",
		label: "StepFun",
		pattern: /(?:^stepfun[/_.-]|(?:^|[/_.-])step-(?:\d|r1))/,
	},
];

export function inferModelVendor(modelId: string): ModelVendor | null {
	const trimmedModelId = modelId.trim();
	if (!trimmedModelId) return null;

	const normalizedModelId = trimmedModelId.toLowerCase();
	const vendor = MODEL_VENDOR_RULES.find(({ pattern }) =>
		pattern.test(normalizedModelId),
	);
	if (vendor) {
		return { key: vendor.key, label: vendor.label };
	}

	const slashIndex = trimmedModelId.indexOf("/");
	if (slashIndex <= 0 || slashIndex === trimmedModelId.length - 1) {
		return null;
	}

	const namespace = trimmedModelId.slice(0, slashIndex).trim();
	const modelName = trimmedModelId.slice(slashIndex + 1).trim();
	if (!namespace || !modelName) return null;

	return {
		key: namespace.toLowerCase(),
		label: namespace,
	};
}

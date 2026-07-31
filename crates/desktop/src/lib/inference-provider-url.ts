import type { InferenceProviderFormatDto } from "../generated/dto";

const PROVIDER_REQUEST_ENDPOINT_SUFFIXES = [
	"/chat/completions",
	"/completions",
	"/responses",
	"/messages",
	"/models",
] as const;

const PROVIDER_REQUEST_ENDPOINT_BY_FORMAT: Record<
	InferenceProviderFormatDto,
	string
> = {
	anthropic: "/messages",
	openai_completions: "/chat/completions",
	openai_responses: "/responses",
};

function inferredApiBaseUrlScheme(value: string) {
	try {
		const hostname = new URL(`http://${value}`).hostname.toLowerCase();
		return hostname === "localhost" ||
			hostname.endsWith(".localhost") ||
			hostname === "0.0.0.0" ||
			hostname === "[::1]" ||
			hostname === "::1" ||
			/^127(?:\.\d{1,3}){3}$/.test(hostname)
			? "http"
			: "https";
	} catch {
		return "https";
	}
}

export function normalizeInferenceProviderApiBaseUrl(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const candidate = trimmed.includes("://")
		? trimmed
		: `${inferredApiBaseUrlScheme(trimmed)}://${trimmed}`;

	try {
		const url = new URL(candidate);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			!url.hostname ||
			url.username ||
			url.password
		) {
			return null;
		}

		let path = url.pathname.replace(/\/+$/, "");
		for (const suffix of PROVIDER_REQUEST_ENDPOINT_SUFFIXES) {
			if (path.endsWith(suffix)) {
				path = path.slice(0, -suffix.length);
				break;
			}
		}
		url.pathname = path || "/";
		url.hash = "";

		const normalized = url.toString();
		return url.pathname === "/" && !url.search
			? normalized.replace(/\/$/, "")
			: normalized;
	} catch {
		return null;
	}
}

export function previewInferenceProviderRequestUrl(
	value: string,
	format: InferenceProviderFormatDto,
) {
	const normalized = normalizeInferenceProviderApiBaseUrl(value);
	if (!normalized) return null;

	const url = new URL(normalized);
	const apiPath = url.pathname.replace(/\/+$/, "") || "/v1";
	url.pathname = `${apiPath}${PROVIDER_REQUEST_ENDPOINT_BY_FORMAT[format]}`;
	return url.toString();
}

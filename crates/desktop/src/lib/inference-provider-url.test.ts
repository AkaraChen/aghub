import { describe, expect, it } from "vitest";
import {
	normalizeInferenceProviderApiBaseUrl,
	previewInferenceProviderRequestUrl,
} from "./inference-provider-url";

describe("normalizeInferenceProviderApiBaseUrl", () => {
	it("adds HTTPS and removes a full request endpoint", () => {
		expect(
			normalizeInferenceProviderApiBaseUrl(
				"api.example.com/v1/chat/completions",
			),
		).toBe("https://api.example.com/v1");
	});

	it("uses HTTP for a local model server", () => {
		expect(
			normalizeInferenceProviderApiBaseUrl("localhost:11434/v1/models"),
		).toBe("http://localhost:11434/v1");
		expect(
			normalizeInferenceProviderApiBaseUrl(
				"models.internal.localhost:11434/v1/models",
			),
		).toBe("http://models.internal.localhost:11434/v1");
	});

	it("uses HTTPS for non-local hosts beginning with localhost", () => {
		expect(
			normalizeInferenceProviderApiBaseUrl("localhost.example.com/v1"),
		).toBe("https://localhost.example.com/v1");
	});

	it("rejects unsupported schemes and URL credentials", () => {
		expect(
			normalizeInferenceProviderApiBaseUrl("ftp://api.example.com/v1"),
		).toBeNull();
		expect(
			normalizeInferenceProviderApiBaseUrl(
				"https://user:secret@api.example.com/v1",
			),
		).toBeNull();
	});
});

describe("previewInferenceProviderRequestUrl", () => {
	it.each([
		["anthropic", "https://api.example.com/v1/messages"],
		["openai_completions", "https://api.example.com/v1/chat/completions"],
		["openai_responses", "https://api.example.com/v1/responses"],
	] as const)("previews the %s request endpoint", (format, expected) => {
		expect(
			previewInferenceProviderRequestUrl(
				"https://api.example.com",
				format,
			),
		).toBe(expected);
	});

	it("preserves a custom API path and query", () => {
		expect(
			previewInferenceProviderRequestUrl(
				"https://api.example.com/coding/v1?api-version=2026",
				"openai_responses",
			),
		).toBe("https://api.example.com/coding/v1/responses?api-version=2026");
	});

	it("replaces a pasted endpoint when the format changes", () => {
		expect(
			previewInferenceProviderRequestUrl(
				"https://api.example.com/v1/chat/completions",
				"anthropic",
			),
		).toBe("https://api.example.com/v1/messages");
	});

	it("omits a preview for an invalid URL", () => {
		expect(
			previewInferenceProviderRequestUrl(
				"ftp://api.example.com",
				"anthropic",
			),
		).toBeNull();
	});
});

import { describe, expect, it } from "vitest";
import { normalizeInferenceProviderApiBaseUrl } from "./inference-provider-url";

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

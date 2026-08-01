import { NetworkError, TimeoutError } from "ky";
import { describe, expect, it } from "vitest";
import { providerModelDiscoveryErrorCode } from "./model-discovery";

const request = new Request("http://localhost/inference/providers/models");

describe("providerModelDiscoveryErrorCode", () => {
	it("distinguishes local timeout and network failures", () => {
		expect(providerModelDiscoveryErrorCode(new TimeoutError(request))).toBe(
			"timeout",
		);
		expect(
			providerModelDiscoveryErrorCode(
				new NetworkError(request, {
					cause: new TypeError("connection refused"),
				}),
			),
		).toBe("network");
	});

	it("uses the unsupported fallback for unknown failures", () => {
		expect(providerModelDiscoveryErrorCode(new Error("unknown"))).toBe(
			"unsupported",
		);
	});
});

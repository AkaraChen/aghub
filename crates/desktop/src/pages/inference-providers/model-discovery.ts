import { isNetworkError, isTimeoutError } from "ky";
import { useEffect, useRef, useState } from "react";
import { getApiErrorCode } from "../../lib/api";

export type ProviderModelDiscoveryErrorCode =
	| "credential_scope"
	| "empty_response"
	| "invalid_api_base_url"
	| "missing_credential"
	| "network"
	| "response_invalid"
	| "response_too_large"
	| "timeout"
	| "unsupported"
	| "upstream_request";

type ProviderModelDiscoveryState =
	| { status: "idle" }
	| { status: "pending" }
	| {
			status: "error";
			code: ProviderModelDiscoveryErrorCode;
	  };

export function providerModelDiscoveryErrorCode(
	error: unknown,
): ProviderModelDiscoveryErrorCode {
	if (isTimeoutError(error)) return "timeout";
	if (isNetworkError(error)) return "network";

	switch (getApiErrorCode(error)) {
		case "INVALID_PARAM":
			return "invalid_api_base_url";
		case "MISSING_CREDENTIAL":
			return "missing_credential";
		case "CREDENTIAL_SCOPE_MISMATCH":
			return "credential_scope";
		case "UPSTREAM_TIMEOUT":
			return "timeout";
		case "UPSTREAM_REQUEST_FAILED":
			return "upstream_request";
		case "UPSTREAM_RESPONSE_TOO_LARGE":
			return "response_too_large";
		case "UPSTREAM_RESPONSE_FAILED":
			return "response_invalid";
		default:
			return "unsupported";
	}
}

export function useProviderModelDiscovery() {
	const nextRequestTokenRef = useRef(0);
	const currentRequestTokenRef = useRef<number | null>(null);
	const [state, setState] = useState<ProviderModelDiscoveryState>({
		status: "idle",
	});

	useEffect(
		() => () => {
			currentRequestTokenRef.current = null;
		},
		[],
	);

	const invalidate = () => {
		currentRequestTokenRef.current = null;
		setState({ status: "idle" });
	};

	const run = async (request: () => Promise<string[]>) => {
		const requestToken = nextRequestTokenRef.current + 1;
		nextRequestTokenRef.current = requestToken;
		currentRequestTokenRef.current = requestToken;
		setState({ status: "pending" });

		try {
			const models = await request();
			if (currentRequestTokenRef.current !== requestToken) return null;
			currentRequestTokenRef.current = null;
			if (models.length === 0) {
				setState({
					status: "error",
					code: "empty_response",
				});
				return null;
			}
			setState({ status: "idle" });
			return models;
		} catch (error) {
			if (currentRequestTokenRef.current !== requestToken) return null;
			currentRequestTokenRef.current = null;
			setState({
				status: "error",
				code: providerModelDiscoveryErrorCode(error),
			});
			return null;
		}
	};

	return {
		errorCode: state.status === "error" ? state.code : null,
		invalidate,
		isPending: state.status === "pending",
		run,
	};
}

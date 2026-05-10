import posthog from "posthog-js";

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

if (key && host) {
	posthog.init(key, {
		api_host: host,
		capture_pageview: false,
		capture_pageleave: false,
		enable_exception_autocapture: true,
	});
}

export function capture(event: string, properties?: Record<string, unknown>) {
	if (!key) return;
	posthog.capture(event, properties);
}

export function captureException(
	error: unknown,
	properties?: Record<string, unknown>,
) {
	if (!key) return;
	posthog.captureException(error, properties);
}

export function identify(
	distinctId: string,
	properties?: Record<string, unknown>,
) {
	if (!key) return;
	posthog.identify(distinctId, properties);
}

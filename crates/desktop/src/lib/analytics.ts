import { invoke } from "@tauri-apps/api/core";

/**
 * PostHog analytics surface.
 *
 * Events are captured from the Rust side via `posthog-rs` because
 * `posthog-js` fetch calls silently fail in Tauri v2 webviews
 * (PostHog/posthog-js#1760). Each helper here is a thin wrapper
 * around a Tauri command that posts the event server-side.
 *
 * Logging is gated by `VITE_POSTHOG_KEY` at build time on both ends.
 * If the key isn't set, the Rust commands no-op — the JS layer still
 * fires the IPC call, but the round-trip is cheap and lets us avoid
 * branching here.
 */

type PropertyValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| PropertyValue[]
	| { [key: string]: PropertyValue };

type Properties = Record<string, PropertyValue>;

function toRustProperties(input?: Record<string, unknown>): Properties {
	if (!input) return {};
	// Drop `undefined` since serde_json doesn't like it; everything
	// else gets serialized via Tauri's MessagePack/JSON IPC.
	const out: Properties = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined) continue;
		out[key] = value as PropertyValue;
	}
	return out;
}

function logFailure(action: string, error: unknown) {
	// Don't toast — analytics failures shouldn't pollute the UI.
	// Console-warn so it shows up in the Tauri log stream.
	console.warn(`[analytics] ${action} failed`, error);
}

export function capture(event: string, properties?: Record<string, unknown>) {
	void invoke("posthog_capture", {
		event,
		properties: toRustProperties(properties),
		distinctId: null,
	}).catch((error) => logFailure(`capture ${event}`, error));
}

export function captureException(
	error: unknown,
	properties?: Record<string, unknown>,
) {
	const err = error instanceof Error ? error : null;
	void invoke("posthog_capture", {
		event: "$exception",
		properties: toRustProperties({
			...properties,
			$exception_message: err?.message ?? String(error),
			$exception_type: err?.name ?? "Error",
			$exception_stack_trace_raw: err?.stack,
		}),
		distinctId: null,
	}).catch((invokeError) => logFailure(`captureException`, invokeError));
}

export function identify(
	distinctId: string,
	properties?: Record<string, unknown>,
) {
	void invoke("posthog_identify", {
		distinctId,
		properties: toRustProperties(properties),
	}).catch((error) => logFailure(`identify ${distinctId}`, error));
}

let exceptionListenersInstalled = false;

/**
 * Forward unhandled errors and promise rejections to PostHog. Must be
 * called once early in the app bootstrap. posthog-js had this on by
 * default via `enable_exception_autocapture`; we replicate it manually
 * here since we no longer ship the JS SDK.
 */
export function installExceptionAutocapture() {
	if (exceptionListenersInstalled) return;
	exceptionListenersInstalled = true;

	window.addEventListener("error", (event) => {
		captureException(event.error ?? event.message, {
			$exception_source: "window.onerror",
			$exception_filename: event.filename,
			$exception_lineno: event.lineno,
			$exception_colno: event.colno,
		});
	});

	window.addEventListener("unhandledrejection", (event) => {
		captureException(event.reason, {
			$exception_source: "unhandledrejection",
		});
	});
}

import { invoke } from "@tauri-apps/api/core";
import posthog from "posthog-js";

/**
 * Hybrid PostHog setup that splits responsibilities between the Rust
 * binary and the Tauri webview:
 *
 *   Rust (posthog-rs)        Webview (posthog-js)
 *   ─────────────────        ──────────────────────
 *   custom event capture     session replay
 *   identify                 autocapture (clicks)
 *   exception forwarding     pageviews
 *   owns distinct_id         exception autocapture
 *                            console capture
 *
 * Why both? posthog-js fetches silently fail in some Tauri v2
 * webviews (PostHog/posthog-js#1760), so we route any *manually
 * triggered* event through Rust to guarantee delivery. posthog-js
 * stays in the loop because session replay, autocapture, and the
 * exception/console listeners are all browser-only features that
 * have no Rust equivalent.
 *
 * The two SDKs share the same `distinct_id`: Rust generates and
 * persists a UUID on first launch, exposes it via the
 * `posthog_get_distinct_id` Tauri command, and the webview boots
 * posthog-js with `bootstrap.distinctID` set to that value. Without
 * this hand-off, replays wouldn't link to the events that triggered
 * them.
 */

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

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
	const out: Properties = {};
	for (const [k, value] of Object.entries(input)) {
		if (value === undefined) continue;
		out[k] = value as PropertyValue;
	}
	return out;
}

function logFailure(action: string, error: unknown) {
	console.warn(`[analytics] ${action} failed`, error);
}

/**
 * Initialize posthog-js for replay + autocapture, bootstrapped with
 * the Rust-owned distinct_id so JS-side replays attach to the same
 * person as Rust-originated events. Must be awaited before any
 * capture call so the distinct_id is in place. Safe to call once.
 */
export async function initBrowserPosthog() {
	if (!key || !host) return;

	let distinctId: string | undefined;
	let sessionId: string | undefined;
	try {
		distinctId = await invoke<string>("posthog_get_distinct_id");
	} catch (error) {
		logFailure("posthog_get_distinct_id", error);
	}
	try {
		sessionId = await invoke<string>("posthog_get_session_id");
	} catch (error) {
		logFailure("posthog_get_session_id", error);
	}

	posthog.init(key, {
		api_host: host,
		// Tie this PostHog instance to the same identity Rust uses.
		// `isIdentifiedID: true` tells PostHog to treat the UUID as a
		// real distinct id (vs. an anonymous one to be merged later).
		bootstrap: distinctId
			? { distinctID: distinctId, isIdentifiedID: true }
			: undefined,
		// We send custom events from Rust via posthog_capture; if both
		// sides send the same event we'd double-count. Disable the JS
		// SDK's autocapture and pageview triggers so it only records
		// what Rust can't reach (replay snapshots + exception traces).
		autocapture: false,
		capture_pageview: false,
		capture_pageleave: false,
		// Turn replay on. The recording lives in posthog-js; there is
		// no Rust replacement for it.
		disable_session_recording: false,
		// posthog-js has its own try/catch around send; this just makes
		// sure it surfaces during local dev.
		debug: import.meta.env.DEV,
	});

	if (sessionId) {
		// Force posthog-js to use the same $session_id Rust attaches to
		// every event so replays group with their triggering events.
		posthog.register({ $session_id: sessionId });
	}
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

	// Also identify on the JS side so replay attaches to the right
	// person going forward. The bootstrap.distinctID set at init is
	// only the *initial* identity; explicit identify() updates it.
	if (key && host) {
		try {
			posthog.identify(distinctId, properties);
		} catch (error) {
			logFailure(`posthog.identify ${distinctId}`, error);
		}
	}
}

let exceptionListenersInstalled = false;

/**
 * Register a fallback for exceptions that posthog-js's exception
 * autocapture might miss. posthog-js installs window.onerror /
 * unhandledrejection listeners of its own, but they go through its
 * own send pipeline — which is the path that may silently fail in
 * Tauri v2. So we add our own listeners that route through the Rust
 * command instead, ensuring the exception still reaches PostHog
 * even if posthog-js drops it. Yes, the same exception will be
 * captured twice in PostHog if posthog-js *does* succeed, but
 * deduplication on the dashboard is preferable to silent loss.
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

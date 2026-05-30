import { invoke } from "@tauri-apps/api/core";
import posthog from "posthog-js";
import { type AppConfig, getCurrentAppConfig } from "./app-config";

/**
 * Hybrid PostHog setup that splits responsibilities between the Rust
 * binary and the Tauri webview:
 *
 *   Rust (posthog-rs)        Webview (posthog-js)
 *   ─────────────────        ──────────────────────
 *   custom event capture     session replay
 *   identify                 autocapture (clicks)
 *   owns app config          pageviews
 *                            exception autocapture
 *                            console capture
 *
 * App config is loaded once via `get_app_config` before React renders.
 * From that point both this module and React components read/update the
 * same config object instead of independently touching env vars or
 * asking Rust for distinct/session IDs.
 */

type Properties = Record<string, unknown>;

function toRustProperties(input?: Record<string, unknown>): Properties {
	if (!input) return {};
	const out: Properties = {};
	for (const [k, value] of Object.entries(input)) {
		if (value === undefined) continue;
		out[k] = value;
	}
	return out;
}

function logFailure(action: string, error: unknown) {
	console.warn(`[analytics] ${action} failed`, error);
}

function isPosthogConfigured(config: AppConfig | null): config is AppConfig {
	return Boolean(config?.posthog.key && config.posthog.host);
}

function isPosthogLoaded() {
	// posthog-js exposes __loaded for this case.
	// biome-ignore lint/suspicious/noExplicitAny: posthog-js internal flag
	return (posthog as any).__loaded === true;
}

/**
 * Initialize posthog-js for replay + autocapture. This is called after
 * the blocking app-config load and before React renders. We still create
 * the JS client when credentials exist even if analytics is disabled;
 * capture paths early-return and the JS client is opted out/stopped.
 */
export function initBrowserPosthog(config = getCurrentAppConfig()) {
	if (!isPosthogConfigured(config)) return;
	if (isPosthogLoaded()) {
		applyAnalyticsConsent(config.analyticsEnabled, config);
		return;
	}

	posthog.init(config.posthog.key, {
		api_host: config.posthog.host,
		bootstrap: {
			distinctID: config.posthog.distinctId,
			isIdentifiedID: true,
		},
		autocapture: false,
		capture_pageview: false,
		capture_pageleave: false,
		disable_session_recording: false,
		session_recording: {
			maskAllInputs: false,
			maskTextSelector: undefined,
			blockSelector: undefined,
		},
		debug: import.meta.env.DEV,
	});

	posthog.register({ $session_id: config.posthog.sessionId });
	applyAnalyticsConsent(config.analyticsEnabled, config);
}

/**
 * Sync browser-only PostHog behavior after app config changes. Rust reads
 * the backend copy of AppConfig directly, so this function only updates
 * the JS SDK state.
 */
export function applyAnalyticsConsent(
	granted: boolean,
	config = getCurrentAppConfig(),
) {
	if (!isPosthogConfigured(config)) return;
	if (!isPosthogLoaded()) {
		initBrowserPosthog(config);
		return;
	}

	if (granted) {
		posthog.opt_in_capturing();
		posthog.startSessionRecording();
	} else {
		posthog.opt_out_capturing();
		posthog.stopSessionRecording();
	}
}

export function capture(event: string, properties?: Record<string, unknown>) {
	const config = getCurrentAppConfig();
	if (!config?.analyticsEnabled) return;
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
	const config = getCurrentAppConfig();
	if (!config?.analyticsEnabled) return;
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
	const config = getCurrentAppConfig();
	if (!config?.analyticsEnabled) return;
	void invoke("posthog_identify", {
		distinctId,
		properties: toRustProperties(properties),
	}).catch((error) => logFailure(`identify ${distinctId}`, error));

	if (isPosthogConfigured(config) && isPosthogLoaded()) {
		try {
			posthog.identify(distinctId, properties);
		} catch (error) {
			logFailure(`posthog.identify ${distinctId}`, error);
		}
	}
}

let exceptionListenersInstalled = false;

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

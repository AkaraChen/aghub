import { type Logger, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { getPosthogConfig } from "./posthog-config";
import { getAnalyticsConsent } from "./store";

/**
 * OpenTelemetry-based log forwarding to PostHog Logs.
 *
 * Sits alongside `./analytics.ts` (which uses posthog-js for events,
 * sessions, and exception capture). PostHog accepts log records at
 * `${POSTHOG_HOST}/i/v1/logs` with the project key as a Bearer
 * token. The values are parsed by Rust and exposed via Tauri IPC.
 *
 * Disabled when:
 * - POSTHOG_KEY / POSTHOG_HOST aren't set,
 * - we're running in dev (`import.meta.env.PROD === false`) — local
 *   noise shouldn't reach production telemetry, or
 * - the user has not granted analytics consent.
 */

const SERVICE_NAME = "aghub-desktop";

const TRAILING_SLASHES = /\/+$/;

let logger: Logger | null = null;
let provider: LoggerProvider | null = null;

function logIngestUrl(posthogHost: string) {
	return `${posthogHost.replace(TRAILING_SLASHES, "")}/i/v1/logs`;
}

async function startLogForwarding() {
	if (logger || !import.meta.env.PROD) return;

	const { key, host } = await getPosthogConfig();
	if (!key || !host || logger) return;

	const exporter = new OTLPLogExporter({
		url: logIngestUrl(host),
		headers: {
			Authorization: `Bearer ${key}`,
		},
	});

	provider = new LoggerProvider({
		resource: resourceFromAttributes({
			"service.name": SERVICE_NAME,
		}),
		processors: [new BatchLogRecordProcessor(exporter)],
	});

	logger = provider.getLogger(SERVICE_NAME);
}

function stopLogForwarding() {
	const activeProvider = provider;
	logger = null;
	provider = null;
	if (activeProvider) {
		void activeProvider.shutdown();
	}
}

export async function initLogForwarding() {
	const consent = await getAnalyticsConsent();
	await setLogForwardingEnabled(consent === "granted");
}

export async function setLogForwardingEnabled(enabled: boolean) {
	if (enabled) {
		await startLogForwarding();
	} else {
		stopLogForwarding();
	}
}

if (typeof window !== "undefined") {
	window.addEventListener("beforeunload", () => {
		stopLogForwarding();
	});
}

interface LogAttributes {
	[key: string]: string | number | boolean | undefined;
}

function emit(
	severity: SeverityNumber,
	severityText: string,
	body: string,
	attributes?: LogAttributes,
) {
	if (!logger) return;
	logger.emit({
		severityNumber: severity,
		severityText,
		body,
		attributes: attributes as Record<string, string | number | boolean>,
	});
}

export const log = {
	debug(body: string, attributes?: LogAttributes) {
		emit(SeverityNumber.DEBUG, "DEBUG", body, attributes);
	},
	info(body: string, attributes?: LogAttributes) {
		emit(SeverityNumber.INFO, "INFO", body, attributes);
	},
	warn(body: string, attributes?: LogAttributes) {
		emit(SeverityNumber.WARN, "WARN", body, attributes);
	},
	error(body: string, attributes?: LogAttributes) {
		emit(SeverityNumber.ERROR, "ERROR", body, attributes);
	},
};

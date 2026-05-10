import { type Logger, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";

/**
 * OpenTelemetry-based log forwarding to PostHog Logs.
 *
 * Sits alongside `./analytics.ts` (which uses posthog-js for events,
 * sessions, and exception capture). PostHog accepts OTLP log records at
 * `${VITE_POSTHOG_HOST}/otlp/v1/logs` with the project key as a Bearer
 * token, so we reuse the same env vars analytics.ts already reads.
 *
 * Disabled when:
 * - VITE_POSTHOG_KEY / VITE_POSTHOG_HOST aren't set, or
 * - we're running in dev (`import.meta.env.PROD === false`) — local
 *   noise shouldn't reach production telemetry.
 */

const SERVICE_NAME = "aghub-desktop";

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host = import.meta.env.VITE_POSTHOG_HOST as string | undefined;
const enabled = Boolean(key && host) && import.meta.env.PROD;

let logger: Logger | null = null;

if (enabled) {
	const exporter = new OTLPLogExporter({
		url: `${host?.replace(/\/+$/, "")}/otlp/v1/logs`,
		headers: {
			Authorization: `Bearer ${key}`,
		},
	});

	const provider = new LoggerProvider({
		resource: resourceFromAttributes({
			"service.name": SERVICE_NAME,
		}),
		processors: [new BatchLogRecordProcessor(exporter)],
	});

	logger = provider.getLogger(SERVICE_NAME);

	// Best-effort flush on tab close / app shutdown so the last logs
	// in the batch don't get dropped.
	if (typeof window !== "undefined") {
		window.addEventListener("beforeunload", () => {
			void provider.shutdown();
		});
	}
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

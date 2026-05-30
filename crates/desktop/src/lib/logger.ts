import { type Logger, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { type AppConfig, getCurrentAppConfig } from "./app-config";

/**
 * OpenTelemetry-based log forwarding to PostHog Logs.
 *
 * Sits alongside `./analytics.ts` (which uses posthog-js for events,
 * sessions, and exception capture). PostHog accepts OTLP log records at
 * `${POSTHOG_HOST}/otlp/v1/logs` with the project key as a Bearer token;
 * both values come from the backend-owned AppConfig loaded before React
 * renders.
 */

const SERVICE_NAME = "aghub-desktop";

let logger: Logger | null = null;

export function initLogForwarding(config: AppConfig = getCurrentAppConfig()!) {
	if (logger) return;
	if (!config?.analyticsEnabled || !config.posthog.key || !import.meta.env.PROD) {
		return;
	}

	const exporter = new OTLPLogExporter({
		url: `${config.posthog.host.replace(/\/+$/, "")}/otlp/v1/logs`,
		headers: {
			Authorization: `Bearer ${config.posthog.key}`,
		},
	});

	const provider = new LoggerProvider({
		resource: resourceFromAttributes({
			"service.name": SERVICE_NAME,
		}),
		processors: [new BatchLogRecordProcessor(exporter)],
	});

	logger = provider.getLogger(SERVICE_NAME);

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

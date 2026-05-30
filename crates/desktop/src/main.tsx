import { attachConsole, info } from "@tauri-apps/plugin-log";
import * as React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import {
	capture,
	initBrowserPosthog,
	installExceptionAutocapture,
} from "./lib/analytics";
import { AppConfigProvider, loadAppConfig } from "./lib/app-config";
import { initLogForwarding, log } from "./lib/logger";

async function bootstrap() {
	try {
		await attachConsole();
		await info("Tauri log stream attached to frontend console");
	} catch (error: unknown) {
		console.error("Failed to attach Tauri log stream:", error);
	}

	// Synchronously block React render on backend-owned app config so
	// PostHog credentials, consent, distinct_id, and session_id all come
	// from one type-safe source of truth.
	const appConfig = await loadAppConfig();
	initBrowserPosthog(appConfig);
	initLogForwarding(appConfig);
	installExceptionAutocapture();
	capture("app started");
	log.info("app started", {
		"app.version": appConfig.appVersion,
	});

	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			<AppConfigProvider initialConfig={appConfig}>
				<App />
			</AppConfigProvider>
		</React.StrictMode>,
	);
}

bootstrap().catch((error: unknown) => {
	console.error("Failed to bootstrap desktop app:", error);
});
